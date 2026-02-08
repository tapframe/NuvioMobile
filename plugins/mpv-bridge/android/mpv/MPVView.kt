package com.nuvio.app.mpv

import android.content.Context
import android.graphics.SurfaceTexture
import android.util.AttributeSet
import android.util.Log
import android.view.Surface
import android.view.TextureView
import dev.jdtech.mpv.MPVLib

class MPVView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : TextureView(context, attrs, defStyleAttr), TextureView.SurfaceTextureListener, MPVLib.EventObserver {

    companion object {
        private const val TAG = "MPVView"
    }

    private var isMpvInitialized = false
    private var pendingDataSource: String? = null
    private var isPaused: Boolean = true
    private var surface: Surface? = null
    private var httpHeaders: Map<String, String>? = null

    // Event listener for React Native
    var onLoadCallback: ((duration: Double, width: Int, height: Int) -> Unit)? = null
    var onProgressCallback: ((position: Double, duration: Double) -> Unit)? = null
    var onEndCallback: (() -> Unit)? = null
    var onErrorCallback: ((message: String) -> Unit)? = null
    var onTracksChangedCallback: ((audioTracks: List<Map<String, Any>>, subtitleTracks: List<Map<String, Any>>) -> Unit)? = null

    init {
        surfaceTextureListener = this
        isOpaque = false
    }

    override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        Log.d(TAG, "Surface texture available: ${width}x${height}")
        try {
            surface = Surface(surfaceTexture)
            
            MPVLib.create(context.applicationContext)
            initOptions()
            MPVLib.init()
            MPVLib.attachSurface(surface!!)
            MPVLib.addObserver(this)
            MPVLib.setPropertyString("android-surface-size", "${width}x${height}")
            observeProperties()
            isMpvInitialized = true
            
            // If a data source was set before surface was ready, load it now
            pendingDataSource?.let { url ->
                applyHttpHeaders()
                loadFile(url)
                pendingDataSource = null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize MPV", e)
            onErrorCallback?.invoke("MPV initialization failed: ${e.message}")
        }
    }

    override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        Log.d(TAG, "Surface texture size changed: ${width}x${height}")
        if (isMpvInitialized) {
            MPVLib.setPropertyString("android-surface-size", "${width}x${height}")
        }
    }

    override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
        Log.d(TAG, "Surface texture destroyed")
        if (isMpvInitialized) {
            MPVLib.removeObserver(this)
            MPVLib.detachSurface()
            MPVLib.destroy()
            isMpvInitialized = false
        }
        surface?.release()
        surface = null
        return true
    }

    override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {
        // Called when the SurfaceTexture is updated via updateTexImage()
    }

    private fun initOptions() {
        // Mobile-optimized profile
        MPVLib.setOptionString("profile", "fast")
        MPVLib.setOptionString("vo", "gpu")
        MPVLib.setOptionString("gpu-context", "android")
        MPVLib.setOptionString("opengl-es", "yes")
        
        // Hardware decoding - use mediacodec-copy to allow subtitle overlay
        // 'mediacodec-copy' copies frames to CPU memory which enables subtitle blending
        MPVLib.setOptionString("hwdec", "auto")
        MPVLib.setOptionString("hwdec-codecs", "all")
        
        // Audio output
        MPVLib.setOptionString("ao", "audiotrack,opensles")
        
        // Network caching for streaming
        MPVLib.setOptionString("demuxer-max-bytes", "67108864") // 64MB
        MPVLib.setOptionString("demuxer-max-back-bytes", "33554432") // 32MB
        MPVLib.setOptionString("cache", "yes")
        MPVLib.setOptionString("cache-secs", "30")
        
        // Network options
        MPVLib.setOptionString("network-timeout", "60") // 60 second timeout
        
        // Subtitle configuration - CRITICAL for Android
        MPVLib.setOptionString("sub-auto", "fuzzy") // Auto-load subtitles
        MPVLib.setOptionString("sub-visibility", "yes") // Make subtitles visible by default
        MPVLib.setOptionString("sub-font-size", "48") // Larger font size for mobile readability
        MPVLib.setOptionString("sub-pos", "95") // Position at bottom (0-100, 100 = very bottom)
        MPVLib.setOptionString("sub-color", "#FFFFFFFF") // White color
        MPVLib.setOptionString("sub-border-size", "3") // Thicker border for readability
        MPVLib.setOptionString("sub-border-color", "#FF000000") // Black border
        MPVLib.setOptionString("sub-shadow-offset", "2") // Add shadow for better visibility
        MPVLib.setOptionString("sub-shadow-color", "#80000000") // Semi-transparent black shadow
        
        // Font configuration - point to Android system fonts for all language support
        MPVLib.setOptionString("osd-fonts-dir", "/system/fonts")
        MPVLib.setOptionString("sub-fonts-dir", "/system/fonts")
        MPVLib.setOptionString("sub-font", "Roboto") // Default fallback font
        // Allow embedded fonts in ASS/SSA but fallback to system fonts
        MPVLib.setOptionString("embeddedfonts", "yes")
        
        // Language/encoding support for various subtitle formats
        MPVLib.setOptionString("sub-codepage", "auto") // Auto-detect encoding (supports UTF-8, Latin, CJK, etc.)
        
        MPVLib.setOptionString("osc", "no") // Disable on screen controller
        MPVLib.setOptionString("osd-level", "1")
    
        // Critical for subtitle rendering on Android GPU
        // blend-subtitles=no lets the GPU renderer handle subtitle overlay properly
        MPVLib.setOptionString("blend-subtitles", "no")
        MPVLib.setOptionString("sub-use-margins", "no")
        // Use 'scale' to allow ASS styling but with our scale and font overrides
        // This preserves styled subtitles while having font fallbacks
        MPVLib.setOptionString("sub-ass-override", "scale")
        MPVLib.setOptionString("sub-scale", "1.0")
        MPVLib.setOptionString("sub-fix-timing", "yes") // Fix timing for SRT subtitles
        
        // Force subtitle rendering
        MPVLib.setOptionString("sid", "auto") // Auto-select subtitle track
        
        // Disable terminal/input
        MPVLib.setOptionString("terminal", "no")
        MPVLib.setOptionString("input-default-bindings", "no")
    }

    private fun observeProperties() {
        // MPV format constants (from MPVLib source)
        val MPV_FORMAT_NONE = 0
        val MPV_FORMAT_FLAG = 3
        val MPV_FORMAT_INT64 = 4
        val MPV_FORMAT_DOUBLE = 5
        
        MPVLib.observeProperty("time-pos", MPV_FORMAT_DOUBLE)
        MPVLib.observeProperty("duration/full", MPV_FORMAT_DOUBLE) // Use /full for complete HLS duration
        MPVLib.observeProperty("pause", MPV_FORMAT_FLAG)
        MPVLib.observeProperty("paused-for-cache", MPV_FORMAT_FLAG)
        MPVLib.observeProperty("eof-reached", MPV_FORMAT_FLAG)
        MPVLib.observeProperty("video-params/aspect", MPV_FORMAT_DOUBLE)
        MPVLib.observeProperty("width", MPV_FORMAT_INT64)
        MPVLib.observeProperty("height", MPV_FORMAT_INT64)
        MPVLib.observeProperty("track-list", MPV_FORMAT_NONE)
        
        // Observe subtitle properties for debugging
        MPVLib.observeProperty("sid", MPV_FORMAT_INT64)
        MPVLib.observeProperty("sub-visibility", MPV_FORMAT_FLAG)
        MPVLib.observeProperty("sub-text", MPV_FORMAT_NONE)
    }

    private fun loadFile(url: String) {
        Log.d(TAG, "Loading file: $url")
        MPVLib.command(arrayOf("loadfile", url))
    }

    // Public API

    fun setDataSource(url: String) {
        if (isMpvInitialized) {
            // Apply headers before loading the file
            applyHttpHeaders()
            loadFile(url)
        } else {
            pendingDataSource = url
        }
    }

    fun setHeaders(headers: Map<String, String>?) {
        httpHeaders = headers
        Log.d(TAG, "Headers set: $headers")
    }

    private fun applyHttpHeaders() {
        httpHeaders?.let { headers ->
            if (headers.isNotEmpty()) {
                // Format headers for MPV: comma-separated "Key: Value" pairs
                val headerList = headers.map { (key, value) -> "$key: $value" }
                val headerString = headerList.joinToString(",")
                Log.d(TAG, "Applying HTTP headers: $headerString")
                MPVLib.setOptionString("http-header-fields", headerString)
            }
        }
    }

    fun setPaused(paused: Boolean) {
        isPaused = paused
        if (isMpvInitialized) {
            MPVLib.setPropertyBoolean("pause", paused)
        }
    }

    fun seekTo(positionSeconds: Double) {
        Log.d(TAG, "seekTo called: positionSeconds=$positionSeconds, isMpvInitialized=$isMpvInitialized")
        if (isMpvInitialized) {
            Log.d(TAG, "Executing MPV seek command: seek $positionSeconds absolute")
            MPVLib.command(arrayOf("seek", positionSeconds.toString(), "absolute"))
        }
    }

    fun setSpeed(speed: Double) {
        if (isMpvInitialized) {
            MPVLib.setPropertyDouble("speed", speed)
        }
    }

    fun setVolume(volume: Double) {
        if (isMpvInitialized) {
            // MPV volume is 0-100
            MPVLib.setPropertyDouble("volume", volume * 100.0)
        }
    }

    fun setAudioTrack(trackId: Int) {
        if (isMpvInitialized) {
            if (trackId == -1) {
                MPVLib.setPropertyString("aid", "no")
            } else {
                MPVLib.setPropertyInt("aid", trackId)
            }
        }
    }

    // Video EQ Properties
    fun setBrightness(value: Int) {
        if (isMpvInitialized) MPVLib.setPropertyInt("brightness", value)
    }

    fun setContrast(value: Int) {
        if (isMpvInitialized) MPVLib.setPropertyInt("contrast", value)
    }

    fun setSaturation(value: Int) {
        if (isMpvInitialized) MPVLib.setPropertyInt("saturation", value)
    }

    fun setGamma(value: Int) {
        if (isMpvInitialized) MPVLib.setPropertyInt("gamma", value)
    }

    fun setHue(value: Int) {
        if (isMpvInitialized) MPVLib.setPropertyInt("hue", value)
    }

    fun setSubtitleTrack(trackId: Int) {
        Log.d(TAG, "setSubtitleTrack called: trackId=$trackId, isMpvInitialized=$isMpvInitialized")
        if (isMpvInitialized) {
            if (trackId == -1) {
                Log.d(TAG, "Disabling subtitles (sid=no)")
                MPVLib.setPropertyString("sid", "no")
                MPVLib.setPropertyString("sub-visibility", "no")
            } else {
                Log.d(TAG, "Setting subtitle track to: $trackId")
                MPVLib.setPropertyInt("sid", trackId)
                // Ensure subtitles are visible
                MPVLib.setPropertyString("sub-visibility", "yes")
                
                // Debug: Verify the subtitle was set correctly
                val currentSid = MPVLib.getPropertyInt("sid")
                val subVisibility = MPVLib.getPropertyString("sub-visibility")
                val subDelay = MPVLib.getPropertyDouble("sub-delay")
                val subScale = MPVLib.getPropertyDouble("sub-scale")
                Log.d(TAG, "After setting - sid=$currentSid, sub-visibility=$subVisibility, sub-delay=$subDelay, sub-scale=$subScale")
            }
        }
    }

    fun setGlslShaders(paths: String) {
        Log.d(TAG, "setGlslShaders called with paths: $paths")
        if (isMpvInitialized) {
            if (paths.isEmpty()) {
                Log.d(TAG, "Clearing GLSL shaders")
                MPVLib.setPropertyString("glsl-shaders", "")
            } else {
                Log.d(TAG, "Setting GLSL shaders")
                // MPV expects a list of paths string like "path1,path2" or specialized list commands
                // Using setPropertyString on "glsl-shaders" usually overwrites the list
                MPVLib.setPropertyString("glsl-shaders", paths)
            }
        }
    }

    fun setResizeMode(mode: String) {
        Log.d(TAG, "setResizeMode called: mode=$mode, isMpvInitialized=$isMpvInitialized")
        if (isMpvInitialized) {
            when (mode) {
                "contain" -> {
                    // Letterbox - show entire video with black bars
                    MPVLib.setPropertyDouble("panscan", 0.0)
                    MPVLib.setPropertyString("keepaspect", "yes")
                }
                "cover" -> {
                    // Fill/crop - zoom to fill, cropping edges
                    MPVLib.setPropertyDouble("panscan", 1.0)
                    MPVLib.setPropertyString("keepaspect", "yes")
                }
                "stretch" -> {
                    // Stretch - disable aspect ratio
                    MPVLib.setPropertyDouble("panscan", 0.0)
                    MPVLib.setPropertyString("keepaspect", "no")
                }
                else -> {
                    // Default to contain
                    MPVLib.setPropertyDouble("panscan", 0.0)
                    MPVLib.setPropertyString("keepaspect", "yes")
                }
            }
        }
    }

    // MPVLib.EventObserver implementation

    override fun eventProperty(property: String) {
        Log.d(TAG, "Property changed: $property")
        when (property) {
            "track-list" -> {
                // Parse track list and notify React Native
                parseAndSendTracks()
            }
        }
    }
    
    private fun parseAndSendTracks() {
        try {
            val trackCount = MPVLib.getPropertyInt("track-list/count") ?: 0
            Log.d(TAG, "Track count: $trackCount")
            
            val audioTracks = mutableListOf<Map<String, Any>>()
            val subtitleTracks = mutableListOf<Map<String, Any>>()
            
            for (i in 0 until trackCount) {
                val type = MPVLib.getPropertyString("track-list/$i/type") ?: continue
                val id = MPVLib.getPropertyInt("track-list/$i/id") ?: continue
                val title = MPVLib.getPropertyString("track-list/$i/title") ?: ""
                val lang = MPVLib.getPropertyString("track-list/$i/lang") ?: ""
                val codec = MPVLib.getPropertyString("track-list/$i/codec") ?: ""
                
                val trackName = when {
                    title.isNotEmpty() -> title
                    lang.isNotEmpty() -> lang.uppercase()
                    else -> "Track $id"
                }
                
                val track = mapOf(
                    "id" to id,
                    "name" to trackName,
                    "language" to lang,
                    "codec" to codec
                )
                
                when (type) {
                    "audio" -> {
                        Log.d(TAG, "Found audio track: $track")
                        audioTracks.add(track)
                    }
                    "sub" -> {
                        Log.d(TAG, "Found subtitle track: $track")
                        subtitleTracks.add(track)
                    }
                }
            }
            
            Log.d(TAG, "Sending tracks - Audio: ${audioTracks.size}, Subtitles: ${subtitleTracks.size}")
            onTracksChangedCallback?.invoke(audioTracks, subtitleTracks)
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing tracks", e)
        }
    }

    override fun eventProperty(property: String, value: Long) {
        Log.d(TAG, "Property $property = $value (Long)")
    }

    override fun eventProperty(property: String, value: Double) {
        Log.d(TAG, "Property $property = $value (Double)")
        when (property) {
            "time-pos" -> {
                val duration = MPVLib.getPropertyDouble("duration/full") ?: MPVLib.getPropertyDouble("duration") ?: 0.0
                onProgressCallback?.invoke(value, duration)
            }
            "duration/full", "duration" -> {
                val width = MPVLib.getPropertyInt("width") ?: 0
                val height = MPVLib.getPropertyInt("height") ?: 0
                onLoadCallback?.invoke(value, width, height)
            }
        }
    }

    override fun eventProperty(property: String, value: Boolean) {
        Log.d(TAG, "Property $property = $value (Boolean)")
        when (property) {
            "eof-reached" -> {
                if (value) {
                    onEndCallback?.invoke()
                }
            }
        }
    }

    override fun eventProperty(property: String, value: String) {
        Log.d(TAG, "Property $property = $value (String)")
    }

    override fun event(eventId: Int) {
        Log.d(TAG, "Event: $eventId")
        // MPV event constants (from MPVLib source)
        val MPV_EVENT_FILE_LOADED = 8
        val MPV_EVENT_END_FILE = 7
        
        when (eventId) {
            MPV_EVENT_FILE_LOADED -> {
                // File is loaded, start playback if not paused
                if (!isPaused) {
                    MPVLib.setPropertyBoolean("pause", false)
                }
            }
            MPV_EVENT_END_FILE -> {
                Log.d(TAG, "MPV_EVENT_END_FILE")
                
                // Heuristic: If duration is effectively 0 at end of file, it's a load error
                val duration = MPVLib.getPropertyDouble("duration/full") ?: MPVLib.getPropertyDouble("duration") ?: 0.0
                val timePos = MPVLib.getPropertyDouble("time-pos") ?: 0.0
                val eofReached = MPVLib.getPropertyBoolean("eof-reached") ?: false
                
                Log.d(TAG, "End stats - Duration: $duration, Time: $timePos, EOF: $eofReached")
                
                if (duration < 1.0 && !eofReached) {
                     val customError = "Unable to play media. Source may be unreachable."
                     Log.e(TAG, "Playback error detected (heuristic): $customError")
                     onErrorCallback?.invoke(customError)
                } else {
                    onEndCallback?.invoke()
                }
            }
        }
    }
}
