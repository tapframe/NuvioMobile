package com.nuvio.app.torrent

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.frostwire.jlibtorrent.AddTorrentParams
import com.frostwire.jlibtorrent.Priority
import com.frostwire.jlibtorrent.SessionManager
import com.frostwire.jlibtorrent.SessionParams
import com.frostwire.jlibtorrent.SettingsPack
import com.frostwire.jlibtorrent.Sha1Hash
import com.frostwire.jlibtorrent.TorrentFlags
import com.frostwire.jlibtorrent.TorrentHandle
import com.frostwire.jlibtorrent.TorrentInfo
import fi.iki.elonen.NanoHTTPD
import java.io.EOFException
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min

class TorrentStreamingModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object {
        private const val TAG = "TorrentStreamingModule"
        private const val HANDLE_TIMEOUT_MS = 30_000L
        private const val METADATA_TIMEOUT_MS = 120_000L
        private const val PIECE_WAIT_MS = 45_000L
        private const val INITIAL_PIECE_WAIT_MS = 15_000L
        private const val STREAMING_WINDOW_PIECES = 112
        private const val STREAMING_BOOST_MIN_STEP = 8
        private const val PREFETCH_WINDOW_PIECES = 256
        private const val PREFETCH_ADVANCE_STEP = 24
        private const val PREFETCH_POLL_INTERVAL_MS = 550L
        private const val HTTP_HOST = "127.0.0.1"
        private const val IO_CHUNK_SIZE = 64 * 1024
    }

    private data class StreamingTuning(
        val streamingWindowPieces: Int,
        val prefetchWindowPieces: Int,
        val prefetchAdvanceStep: Int,
        val pieceDeadlineStepMs: Int,
        val boostNearPieces: Int,
        val boostMidPieces: Int
    )

    private data class ActiveTorrentStream(
        val streamId: String,
        val infoHash: String,
        val saveDir: File,
        val handle: TorrentHandle,
        val fileIndex: Int,
        val fileName: String,
        val filePath: File,
        val fileSize: Long,
        val fileOffset: Long,
        val pieceLength: Int,
        val totalPieces: Int,
        val fileStartPiece: Int,
        val fileEndPiece: Int,
        val streamingWindowPieces: Int,
        val prefetchWindowPieces: Int,
        val prefetchAdvanceStep: Int,
        val pieceDeadlineStepMs: Int,
        val boostNearPieces: Int,
        val boostMidPieces: Int,
        @Volatile var nextPrefetchPiece: Int = 0,
        @Volatile var lastBoostedPiece: Int = -1
    )

    private val lock = Any()
    private val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val prefetchExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val activeStreams = ConcurrentHashMap<String, ActiveTorrentStream>()

    @Volatile
    private var sessionManager: SessionManager? = null

    @Volatile
    private var httpServer: TorrentHttpServer? = null

    override fun getName(): String = "TorrentStreamingModule"

    @ReactMethod
    fun prepareStream(options: ReadableMap, promise: Promise) {
        val magnetUri = options.getString("magnetUri")
        if (magnetUri.isNullOrBlank()) {
            promise.reject("TORRENT_INVALID_INPUT", "Missing magnetUri")
            return
        }

        val streamTitle = if (options.hasKey("streamTitle") && !options.isNull("streamTitle")) {
            options.getString("streamTitle")
        } else {
            null
        }

        val preferredFileIndex = if (options.hasKey("fileIndex") && !options.isNull("fileIndex")) {
            options.getDouble("fileIndex").toInt()
        } else {
            null
        }

        val trackers = mutableListOf<String>()
        if (options.hasKey("trackers") && !options.isNull("trackers")) {
            val arr = options.getArray("trackers")
            if (arr != null) {
                trackers.addAll(readableArrayToStringList(arr))
            }
        }

        val networkMbps = if (options.hasKey("networkMbps") && !options.isNull("networkMbps")) {
            options.getDouble("networkMbps")
        } else {
            null
        }

        ioExecutor.execute {
            try {
                val result = prepareStreamInternal(
                    magnetUri = magnetUri,
                    streamTitle = streamTitle,
                    preferredFileIndex = preferredFileIndex,
                    trackers = trackers,
                    networkMbps = networkMbps
                )
                promise.resolve(result)
            } catch (e: Throwable) {
                Log.e(TAG, "prepareStream failed", e)
                promise.reject("TORRENT_PREPARE_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun stopStream(streamId: String, promise: Promise) {
        ioExecutor.execute {
            try {
                synchronized(lock) {
                    val stream = activeStreams.remove(streamId)
                    if (stream != null) {
                        stopStreamLocked(stream, cleanupFiles = true)
                    }
                }
                promise.resolve(true)
            } catch (e: Throwable) {
                Log.e(TAG, "stopStream failed", e)
                promise.reject("TORRENT_STOP_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun stopAllStreams(promise: Promise) {
        ioExecutor.execute {
            try {
                synchronized(lock) {
                    stopAllStreamsLocked(cleanupFiles = true)
                }
                promise.resolve(true)
            } catch (e: Throwable) {
                Log.e(TAG, "stopAllStreams failed", e)
                promise.reject("TORRENT_STOP_ALL_FAILED", e.message, e)
            }
        }
    }

    override fun invalidate() {
        super.invalidate()
        try {
            ioExecutor.execute {
                synchronized(lock) {
                    shutdownLocked()
                }
            }
        } catch (_: Throwable) {
        } finally {
            ioExecutor.shutdown()
            prefetchExecutor.shutdownNow()
            try {
                ioExecutor.awaitTermination(1500, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            try {
                prefetchExecutor.awaitTermination(1500, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
    }

    private fun prepareStreamInternal(
        magnetUri: String,
        streamTitle: String?,
        preferredFileIndex: Int?,
        trackers: List<String>,
        networkMbps: Double?
    ): com.facebook.react.bridge.WritableMap {
        synchronized(lock) {
            ensureSessionStartedLocked()
            ensureHttpServerStartedLocked()
            stopAllStreamsLocked(cleanupFiles = true)
        }

        val finalMagnet = mergeTrackersIntoMagnet(magnetUri, trackers)
        val parsedParams = AddTorrentParams.parseMagnetUri(finalMagnet)
        val infoHash = parsedParams.getInfoHashes().getBest()
        val infoHashHex = infoHash.toHex().lowercase(Locale.US)

        val saveDir = File(getBaseTorrentDir(), infoHashHex)
        if (!saveDir.exists()) {
            saveDir.mkdirs()
        }

        val sm = sessionManager ?: throw IllegalStateException("Torrent session is not initialized")
        sm.download(finalMagnet, saveDir, TorrentFlags.SEQUENTIAL_DOWNLOAD)

        val handle = waitForHandle(infoHash, HANDLE_TIMEOUT_MS)
            ?: throw IllegalStateException("Timed out while waiting for torrent handle")

        handle.resume()

        val torrentInfo = waitForMetadata(handle, METADATA_TIMEOUT_MS)
            ?: throw IllegalStateException("Timed out while waiting for torrent metadata")

        val selectedFileIndex = selectPlayableFileIndex(torrentInfo, preferredFileIndex)
        if (selectedFileIndex < 0) {
            throw IllegalStateException("No playable video file found in torrent")
        }

        prioritizeSelectedFile(handle, torrentInfo, selectedFileIndex)

        val fs = torrentInfo.files()
        val relativePath = fs.filePath(selectedFileIndex).ifBlank { "stream.bin" }
        val absolutePath = fs.filePath(selectedFileIndex, saveDir.absolutePath)
        val filePath = File(absolutePath)
        val fileSize = fs.fileSize(selectedFileIndex)
        val fileOffset = fs.fileOffset(selectedFileIndex)
        val pieceLength = max(1, torrentInfo.pieceLength())
        val totalPieces = max(1, torrentInfo.numPieces())
        val firstPiece = (fileOffset / pieceLength.toLong()).toInt().coerceIn(0, totalPieces - 1)
        val lastPiece = ((fileOffset + max(1L, fileSize) - 1L) / pieceLength.toLong())
            .toInt()
            .coerceIn(firstPiece, totalPieces - 1)
        val tuning = deriveStreamingTuning(networkMbps)

        val streamId = UUID.randomUUID().toString()
        val stream = ActiveTorrentStream(
            streamId = streamId,
            infoHash = infoHashHex,
            saveDir = saveDir,
            handle = handle,
            fileIndex = selectedFileIndex,
            fileName = relativePath,
            filePath = filePath,
            fileSize = fileSize,
            fileOffset = fileOffset,
            pieceLength = pieceLength,
            totalPieces = totalPieces,
            fileStartPiece = firstPiece,
            fileEndPiece = lastPiece,
            streamingWindowPieces = tuning.streamingWindowPieces,
            prefetchWindowPieces = tuning.prefetchWindowPieces,
            prefetchAdvanceStep = tuning.prefetchAdvanceStep,
            pieceDeadlineStepMs = tuning.pieceDeadlineStepMs,
            boostNearPieces = tuning.boostNearPieces,
            boostMidPieces = tuning.boostMidPieces,
            nextPrefetchPiece = firstPiece
        )

        synchronized(lock) {
            activeStreams[streamId] = stream
        }

        boostPieceWindow(stream, firstPiece, stream.prefetchWindowPieces)
        startPrefetchLoop(stream)
        waitForPiece(stream, firstPiece, INITIAL_PIECE_WAIT_MS)

        val serverPort = httpServer?.listeningPort
            ?: throw IllegalStateException("Torrent HTTP bridge is not running")
        val playbackUrl = "http://$HTTP_HOST:$serverPort/torrent/$streamId"

        val result = Arguments.createMap()
        result.putString("streamId", streamId)
        result.putString("playbackUrl", playbackUrl)
        result.putString("infoHash", infoHashHex)
        result.putString("fileName", stream.fileName)
        result.putDouble("fileSize", stream.fileSize.toDouble())
        result.putString("mimeType", guessMimeType(stream.fileName))
        result.putString("streamTitle", streamTitle)
        result.putDouble("networkMbps", networkMbps ?: 0.0)

        return result
    }

    private fun deriveStreamingTuning(networkMbps: Double?): StreamingTuning {
        val mbps = if (networkMbps != null && networkMbps.isFinite() && networkMbps > 0.0) {
            networkMbps
        } else {
            20.0
        }

        return when {
            mbps <= 1.5 -> StreamingTuning(
                streamingWindowPieces = 64,
                prefetchWindowPieces = 128,
                prefetchAdvanceStep = 12,
                pieceDeadlineStepMs = 160,
                boostNearPieces = 14,
                boostMidPieces = 28
            )
            mbps <= 5.0 -> StreamingTuning(
                streamingWindowPieces = 88,
                prefetchWindowPieces = 192,
                prefetchAdvanceStep = 18,
                pieceDeadlineStepMs = 145,
                boostNearPieces = 18,
                boostMidPieces = 36
            )
            mbps <= 20.0 -> StreamingTuning(
                streamingWindowPieces = STREAMING_WINDOW_PIECES,
                prefetchWindowPieces = PREFETCH_WINDOW_PIECES,
                prefetchAdvanceStep = PREFETCH_ADVANCE_STEP,
                pieceDeadlineStepMs = 120,
                boostNearPieces = 24,
                boostMidPieces = 48
            )
            mbps <= 80.0 -> StreamingTuning(
                streamingWindowPieces = 144,
                prefetchWindowPieces = 320,
                prefetchAdvanceStep = 32,
                pieceDeadlineStepMs = 100,
                boostNearPieces = 28,
                boostMidPieces = 56
            )
            mbps <= 250.0 -> StreamingTuning(
                streamingWindowPieces = 176,
                prefetchWindowPieces = 384,
                prefetchAdvanceStep = 40,
                pieceDeadlineStepMs = 85,
                boostNearPieces = 32,
                boostMidPieces = 64
            )
            else -> StreamingTuning(
                streamingWindowPieces = 224,
                prefetchWindowPieces = 448,
                prefetchAdvanceStep = 48,
                pieceDeadlineStepMs = 70,
                boostNearPieces = 36,
                boostMidPieces = 72
            )
        }
    }

    private fun ensureSessionStartedLocked() {
        if (sessionManager?.isRunning == true) {
            return
        }

        val settings = SettingsPack()
            .downloadRateLimit(0)
            .uploadRateLimit(0)
            .activeDownloads(8)
            .activeSeeds(2)
            .connectionsLimit(200)
            .alertQueueSize(20000)

        val params = SessionParams(settings)
        val sm = SessionManager(false)
        sm.start(params)
        sessionManager = sm
    }

    private fun ensureHttpServerStartedLocked() {
        if (httpServer != null) {
            return
        }

        val server = TorrentHttpServer(0)
        server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
        httpServer = server
    }

    private fun shutdownLocked() {
        stopAllStreamsLocked(cleanupFiles = true)
        try {
            httpServer?.stop()
        } catch (_: Throwable) {
        }
        httpServer = null

        try {
            sessionManager?.stop()
        } catch (_: Throwable) {
        }
        sessionManager = null
    }

    private fun stopAllStreamsLocked(cleanupFiles: Boolean) {
        val current = activeStreams.values.toList()
        activeStreams.clear()
        current.forEach { stream ->
            stopStreamLocked(stream, cleanupFiles)
        }
    }

    private fun stopStreamLocked(stream: ActiveTorrentStream, cleanupFiles: Boolean) {
        try {
            sessionManager?.remove(stream.handle)
        } catch (_: Throwable) {
        }

        if (cleanupFiles) {
            deleteRecursively(stream.saveDir)
        }
    }

    private fun waitForHandle(infoHash: Sha1Hash, timeoutMs: Long): TorrentHandle? {
        val startedAt = System.currentTimeMillis()
        while (System.currentTimeMillis() - startedAt < timeoutMs) {
            val handle = sessionManager?.find(infoHash)
            if (handle != null && handle.isValid) {
                return handle
            }
            try {
                Thread.sleep(200)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                break
            }
        }
        val fallback = sessionManager?.find(infoHash)
        return if (fallback != null && fallback.isValid) fallback else null
    }

    private fun waitForMetadata(handle: TorrentHandle, timeoutMs: Long): TorrentInfo? {
        val startedAt = System.currentTimeMillis()
        while (System.currentTimeMillis() - startedAt < timeoutMs) {
            try {
                val ti = handle.torrentFile()
                if (ti != null && ti.isValid && ti.numFiles() > 0) {
                    return ti
                }
            } catch (_: Throwable) {
            }

            try {
                Thread.sleep(250)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                break
            }
        }
        return null
    }

    private fun selectPlayableFileIndex(torrentInfo: TorrentInfo, preferredFileIndex: Int?): Int {
        val fs = torrentInfo.files()
        val totalFiles = fs.numFiles()
        if (totalFiles <= 0) return -1

        if (preferredFileIndex != null && preferredFileIndex in 0 until totalFiles) {
            val preferredPath = fs.filePath(preferredFileIndex).lowercase(Locale.US)
            if (isLikelyVideoFile(preferredPath)) {
                return preferredFileIndex
            }
        }

        var bestIndex = -1
        var bestScore = Long.MIN_VALUE
        var fallbackLargestIndex = 0
        var fallbackLargestSize = Long.MIN_VALUE

        for (i in 0 until totalFiles) {
            val size = fs.fileSize(i)
            val path = fs.filePath(i)
            val lowerPath = path.lowercase(Locale.US)

            if (size > fallbackLargestSize) {
                fallbackLargestSize = size
                fallbackLargestIndex = i
            }

            if (!isLikelyVideoFile(lowerPath)) {
                continue
            }

            var score = size
            if (lowerPath.contains("/sample") || lowerPath.contains("sample.")) score -= 500_000_000L
            if (lowerPath.contains("trailer")) score -= 300_000_000L
            if (lowerPath.contains("extras")) score -= 200_000_000L
            if (lowerPath.contains("featurette")) score -= 200_000_000L

            if (score > bestScore) {
                bestScore = score
                bestIndex = i
            }
        }

        return if (bestIndex >= 0) bestIndex else fallbackLargestIndex
    }

    private fun prioritizeSelectedFile(handle: TorrentHandle, torrentInfo: TorrentInfo, selectedFileIndex: Int) {
        val filesCount = max(1, torrentInfo.numFiles())
        val priorities = Priority.array(Priority.IGNORE, filesCount)
        priorities[selectedFileIndex] = Priority.SEVEN
        handle.prioritizeFiles(priorities)
    }

    private fun waitForPiece(stream: ActiveTorrentStream, pieceIndex: Int, timeoutMs: Long): Boolean {
        if (!stream.handle.isValid) {
            return false
        }

        val safePiece = pieceIndex.coerceIn(stream.fileStartPiece, stream.fileEndPiece)
        val startedAt = System.currentTimeMillis()

        while (System.currentTimeMillis() - startedAt < timeoutMs) {
            try {
                if (stream.handle.havePiece(safePiece)) {
                    return true
                }
            } catch (_: Throwable) {
                return false
            }

            boostPieceWindow(stream, safePiece)

            try {
                Thread.sleep(120)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return false
            }
        }

        return try {
            stream.handle.havePiece(safePiece)
        } catch (_: Throwable) {
            false
        }
    }

    private fun boostPieceWindow(
        stream: ActiveTorrentStream,
        fromPiece: Int,
        windowPieces: Int? = null
    ) {
        if (!stream.handle.isValid) {
            return
        }

        val startPiece = fromPiece.coerceIn(stream.fileStartPiece, stream.fileEndPiece)
        if (stream.lastBoostedPiece >= 0 && startPiece <= stream.lastBoostedPiece + STREAMING_BOOST_MIN_STEP) {
            return
        }

        val effectiveWindowPieces = max(1, windowPieces ?: stream.streamingWindowPieces)
        val endPiece = min(stream.fileEndPiece, startPiece + effectiveWindowPieces)
        for (piece in startPiece..endPiece) {
            try {
                val pieceOffset = piece - startPiece
                val priority = when {
                    pieceOffset < stream.boostNearPieces -> Priority.SEVEN
                    pieceOffset < stream.boostMidPieces -> Priority.SIX
                    else -> Priority.FOUR
                }
                stream.handle.piecePriority(piece, priority)
                stream.handle.setPieceDeadline(piece, pieceOffset * stream.pieceDeadlineStepMs)
            } catch (_: Throwable) {
                break
            }
        }
        stream.lastBoostedPiece = startPiece
    }

    private fun startPrefetchLoop(stream: ActiveTorrentStream) {
        prefetchExecutor.execute {
            while (true) {
                val isStillActive = synchronized(lock) {
                    activeStreams[stream.streamId] === stream
                }
                if (!isStillActive) {
                    break
                }

                if (!stream.handle.isValid) {
                    break
                }

                val fromPiece = stream.nextPrefetchPiece.coerceIn(stream.fileStartPiece, stream.fileEndPiece)
                val nextMissing = findNextMissingPiece(stream, fromPiece)
                if (nextMissing < 0) {
                    break
                }

                boostPieceWindow(stream, nextMissing, stream.prefetchWindowPieces)
                stream.nextPrefetchPiece = min(stream.fileEndPiece, nextMissing + stream.prefetchAdvanceStep)

                try {
                    Thread.sleep(PREFETCH_POLL_INTERVAL_MS)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            }
        }
    }

    private fun findNextMissingPiece(stream: ActiveTorrentStream, fromPiece: Int): Int {
        if (!stream.handle.isValid) return -1

        val start = stream.fileStartPiece
        val end = stream.fileEndPiece
        val pivot = fromPiece.coerceIn(start, end)

        for (piece in pivot..end) {
            try {
                if (!stream.handle.havePiece(piece)) return piece
            } catch (_: Throwable) {
                return -1
            }
        }

        for (piece in start until pivot) {
            try {
                if (!stream.handle.havePiece(piece)) return piece
            } catch (_: Throwable) {
                return -1
            }
        }

        return -1
    }

    private fun mergeTrackersIntoMagnet(magnetUri: String, trackers: List<String>): String {
        if (trackers.isEmpty() || !magnetUri.startsWith("magnet:?")) {
            return magnetUri
        }

        val existingTrackers = mutableSetOf<String>()
        val query = magnetUri.substringAfter('?', "")
        if (query.isNotBlank()) {
            query.split('&').forEach { part ->
                if (part.startsWith("tr=", ignoreCase = true)) {
                    val encoded = part.substringAfter("tr=", "")
                    val decoded = URLDecoder.decode(encoded, Charsets.UTF_8.name())
                    if (decoded.isNotBlank()) {
                        existingTrackers.add(decoded)
                    }
                }
            }
        }

        val builder = StringBuilder(magnetUri)
        trackers.forEach { tracker ->
            val normalized = tracker.trim()
            if (normalized.isNotBlank() && existingTrackers.add(normalized)) {
                builder.append("&tr=").append(URLEncoder.encode(normalized, Charsets.UTF_8.name()))
            }
        }

        return builder.toString()
    }

    private fun getBaseTorrentDir(): File {
        val dir = File(context.cacheDir, "torrent-stream")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    private fun deleteRecursively(file: File) {
        if (!file.exists()) return
        if (file.isDirectory) {
            file.listFiles()?.forEach { child ->
                deleteRecursively(child)
            }
        }
        file.delete()
    }

    private fun readableArrayToStringList(arr: ReadableArray): List<String> {
        val out = mutableListOf<String>()
        for (i in 0 until arr.size()) {
            if (!arr.isNull(i)) {
                val value = arr.getString(i)
                if (!value.isNullOrBlank()) {
                    out.add(value)
                }
            }
        }
        return out
    }

    private fun guessMimeType(path: String): String {
        val lower = path.lowercase(Locale.US)
        return when {
            lower.endsWith(".mkv") -> "video/x-matroska"
            lower.endsWith(".mp4") || lower.endsWith(".m4v") -> "video/mp4"
            lower.endsWith(".webm") -> "video/webm"
            lower.endsWith(".avi") -> "video/x-msvideo"
            lower.endsWith(".mov") -> "video/quicktime"
            lower.endsWith(".ts") || lower.endsWith(".m2ts") -> "video/mp2t"
            lower.endsWith(".mpg") || lower.endsWith(".mpeg") -> "video/mpeg"
            else -> "application/octet-stream"
        }
    }

    private fun isLikelyVideoFile(path: String): Boolean {
        return path.endsWith(".mkv") ||
            path.endsWith(".mp4") ||
            path.endsWith(".m4v") ||
            path.endsWith(".avi") ||
            path.endsWith(".webm") ||
            path.endsWith(".mov") ||
            path.endsWith(".ts") ||
            path.endsWith(".m2ts") ||
            path.endsWith(".mpg") ||
            path.endsWith(".mpeg")
    }

    private fun parseRangeHeader(rangeHeader: String?, fileSize: Long): Pair<Long, Long>? {
        if (rangeHeader.isNullOrBlank() || !rangeHeader.startsWith("bytes=") || fileSize <= 0) {
            return null
        }

        val range = rangeHeader.removePrefix("bytes=").trim()
        val parts = range.split("-", limit = 2)
        if (parts.size != 2) return null

        val startText = parts[0].trim()
        val endText = parts[1].trim()

        val start: Long
        val end: Long

        when {
            startText.isBlank() -> {
                val suffixLength = endText.toLongOrNull() ?: return null
                if (suffixLength <= 0) return null
                start = max(0L, fileSize - suffixLength)
                end = fileSize - 1
            }

            endText.isBlank() -> {
                start = startText.toLongOrNull() ?: return null
                end = fileSize - 1
            }

            else -> {
                start = startText.toLongOrNull() ?: return null
                end = endText.toLongOrNull() ?: return null
            }
        }

        if (start < 0 || start >= fileSize) return null
        if (end < start) return null

        return start to min(end, fileSize - 1)
    }

    private inner class TorrentInputStream(
        private val stream: ActiveTorrentStream,
        startOffset: Long,
        private val length: Long
    ) : InputStream() {
        private var offsetInFile = startOffset
        private var remaining = length
        private var raf: RandomAccessFile? = null

        override fun read(): Int {
            val single = ByteArray(1)
            val read = read(single, 0, 1)
            return if (read <= 0) -1 else single[0].toInt() and 0xFF
        }

        override fun read(buffer: ByteArray, off: Int, len: Int): Int {
            if (remaining <= 0) return -1
            if (len <= 0) return 0

            val requested = min(len.toLong(), remaining).toInt()
            val globalOffset = stream.fileOffset + offsetInFile
            val pieceIndex = (globalOffset / stream.pieceLength.toLong()).toInt().coerceIn(0, stream.totalPieces - 1)

            if (!waitForPiece(stream, pieceIndex, PIECE_WAIT_MS)) {
                throw EOFException("Timed out waiting for piece $pieceIndex")
            }
            boostPieceWindow(stream, pieceIndex)

            val pieceEndOffsetGlobal = (pieceIndex + 1L) * stream.pieceLength.toLong()
            val maxInPiece = max(1L, pieceEndOffsetGlobal - globalOffset)
            val chunkSize = min(requested.toLong(), min(maxInPiece, IO_CHUNK_SIZE.toLong())).toInt()

            val randomAccessFile = ensureFileOpen()

            var bytesRead = -1
            var attempts = 0
            while (bytesRead <= 0 && attempts < 20) {
                randomAccessFile.seek(offsetInFile)
                bytesRead = randomAccessFile.read(buffer, off, chunkSize)
                if (bytesRead <= 0) {
                    attempts++
                    try {
                        Thread.sleep(80)
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        break
                    }
                }
            }

            if (bytesRead <= 0) {
                throw EOFException("Unable to read torrent bytes from disk")
            }

            offsetInFile += bytesRead.toLong()
            remaining -= bytesRead.toLong()
            return bytesRead
        }

        override fun close() {
            try {
                raf?.close()
            } catch (_: Throwable) {
            }
            raf = null
            super.close()
        }

        @Throws(IOException::class)
        private fun ensureFileOpen(): RandomAccessFile {
            raf?.let { return it }

            var attempts = 0
            while (attempts < 120) {
                if (stream.filePath.exists()) {
                    val open = RandomAccessFile(stream.filePath, "r")
                    raf = open
                    return open
                }
                attempts++
                try {
                    Thread.sleep(100)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            }

            throw IOException("Torrent file does not exist yet: ${stream.filePath.absolutePath}")
        }
    }

    private inner class TorrentHttpServer(port: Int) : NanoHTTPD(HTTP_HOST, port) {
        override fun serve(session: IHTTPSession): Response {
            return try {
                val uri = session.uri ?: "/"
                if (!uri.startsWith("/torrent/")) {
                    newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
                } else {
                    serveTorrentRequest(session)
                }
            } catch (e: Throwable) {
                Log.e(TAG, "HTTP serve failed", e)
                newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Internal error")
            }
        }

        private fun serveTorrentRequest(session: IHTTPSession): Response {
            if (session.method != Method.GET && session.method != Method.HEAD) {
                return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "Method not allowed")
            }

            val streamId = session.uri.removePrefix("/torrent/").substringBefore('/')
            val stream = activeStreams[streamId]
                ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Stream not found")

            val rangeHeader = session.headers["range"]
            val parsedRange = parseRangeHeader(rangeHeader, stream.fileSize)

            val start = parsedRange?.first ?: 0L
            val end = parsedRange?.second ?: (stream.fileSize - 1L)

            if (start < 0 || end < start || start >= stream.fileSize) {
                val invalid = newFixedLengthResponse(
                    Response.Status.RANGE_NOT_SATISFIABLE,
                    "text/plain",
                    "Requested range not satisfiable"
                )
                invalid.addHeader("Accept-Ranges", "bytes")
                invalid.addHeader("Content-Range", "bytes */${stream.fileSize}")
                return invalid
            }

            val length = end - start + 1L
            val status = if (parsedRange != null) Response.Status.PARTIAL_CONTENT else Response.Status.OK
            val mimeType = guessMimeType(stream.fileName)

            val response = if (session.method == Method.HEAD) {
                newFixedLengthResponse(status, mimeType, "")
            } else {
                val input = TorrentInputStream(stream, start, length)
                newFixedLengthResponse(status, mimeType, input, length)
            }

            response.addHeader("Accept-Ranges", "bytes")
            response.addHeader("Content-Length", length.toString())
            response.addHeader("Connection", "keep-alive")
            if (parsedRange != null) {
                response.addHeader("Content-Range", "bytes $start-$end/${stream.fileSize}")
            }
            return response
        }
    }
}
