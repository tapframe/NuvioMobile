package com.nuvio.app.mpv

import android.content.Context
import android.graphics.SurfaceTexture
import android.util.AttributeSet
import android.util.Log
import android.view.Surface
import android.view.TextureView
import dev.jdtech.mpv.MPVLib

import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext

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
    
    // Decoder mode setting: 'auto', 'sw', 'hw', 'hw+' (default: auto)
    var decoderMode: String = "auto"
    
    // GPU mode setting: 'gpu', 'gpu-next' (default: gpu)
    var gpuMode: String = "gpu"
    
    // GLSL shaders setting (for upscalers)
    private var glslShadersVal: String? = null

    // Flag to track if onLoad has been fired (prevents multiple fires for HLS streams)
    private var hasLoadEventFired: Boolean = false

    // Video Equalizer state
    private var brightnessVal: Int = 0
    private var contrastVal: Int = 0
    private var saturationVal: Int = 0
    private var gammaVal: Int = 0
    private var hueVal: Int = 0

    // Event listener for React Native
    var onLoadCallback: ((duration: Double, width: Int, height: Int) -> Unit)? = null
    var onProgressCallback: ((position: Double, duration: Double) -> Unit)? = null
    var onEndCallback: (() -> Unit)? = null
    var onErrorCallback: ((message: String) -> Unit)? = null
    var onTracksChangedCallback: ((audioTracks: List<Map<String, Any>>, subtitleTracks: List<Map<String, Any>>) -> Unit)? = null

    private var resumeOnForeground = false
    private val lifeCycleListener = object : LifecycleEventListener {
        override fun onHostPause() {
                resumeOnForeground = !isPaused;
                if(resumeOnForeground) {
                Log.d(TAG, "App backgrounded — pausing MPV")
                setPaused(true)
                }
            }
            override fun onHostResume() {
                if(resumeOnForeground) {
                    setPaused(false)
                    resumeOnForeground = false
                }
            }
            override fun onHostDestroy() {}
    }
    init {
        surfaceTextureListener = this
        isOpaque = false
        (context as? ReactContext)?.addLifecycleEventListener(lifeCycleListener)
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
            applyPostInitSettings()
            isMpvInitialized = true
            
            // If a data source was set before surface was ready, load it now
            // Headers are already applied in initOptions() before init()
            pendingDataSource?.let { url ->
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
        (context as? ReactContext)?.removeLifecycleEventListener(lifeCycleListener)
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
        MPVLib.setOptionString("profile", "fast")
        
        // GPU rendering mode (gpu or gpu-next)
        MPVLib.setOptionString("vo", gpuMode)
        MPVLib.setOptionString("gpu-context", "android")
        MPVLib.setOptionString("opengl-es", "yes")
        
        // Decoder mode mapping (same as mpvKt)
        val hwdecValue = when (decoderMode) {
            "auto" -> "auto-copy"      // Best balance: HW decode, copy to CPU for filters
            "sw" -> "no"               // Software decoding only
            "hw" -> "mediacodec-copy"  // HW decode with copy (safer)
            "hw+" -> "mediacodec"      // Full HW decode (fastest, may have issues)
            else -> "auto-copy"
        }
        Log.d(TAG, "Decoder mode: $decoderMode, hwdec value: $hwdecValue, GPU mode: $gpuMode")
        MPVLib.setOptionString("hwdec", hwdecValue)
        // Note: Not setting hwdec-codecs explicitly - let mpv use defaults
        
        MPVLib.setOptionString("target-colorspace-hint", "yes")
        
        // HDR and Dolby Vision support
        // target-prim: Signal target display primaries (auto = passthrough when display supports)
        MPVLib.setOptionString("target-prim", "auto")
        // target-trc: Signal target transfer characteristics (auto = passthrough when display supports)  
        MPVLib.setOptionString("target-trc", "auto")
        // tone-mapping: How to handle HDR/DV content on SDR displays (auto = best automatic choice)
        MPVLib.setOptionString("tone-mapping", "auto")
        // hdr-compute-peak: Compute peak brightness for better tone mapping
        MPVLib.setOptionString("hdr-compute-peak", "auto")
        // Allow DV Profile 5 (HEVC with RPU) to be decoded by hardware decoder
        MPVLib.setOptionString("vd-lavc-o", "strict=-2")
        
        // Workaround for https://github.com/mpv-player/mpv/issues/14651
        MPVLib.setOptionString("vd-lavc-film-grain", "cpu")
        
        MPVLib.setOptionString("ao", "audiotrack,opensles")
        
        // Limit demuxer cache based on Android version (like mpvKt)
        val cacheMegs = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) 64 else 32
        MPVLib.setOptionString("demuxer-max-bytes", "${cacheMegs * 1024 * 1024}")
        MPVLib.setOptionString("demuxer-max-back-bytes", "${cacheMegs * 1024 * 1024}")
        MPVLib.setOptionString("cache", "yes")
        MPVLib.setOptionString("cache-secs", "30")
        
        MPVLib.setOptionString("network-timeout", "60")
        MPVLib.setOptionString("ytdl", "no")
        
        applyHttpHeadersAsOptions()
        
        MPVLib.setOptionString("tls-verify", "no")
        MPVLib.setOptionString("http-reconnect", "yes")
        MPVLib.setOptionString("stream-reconnect", "yes")
        
        MPVLib.setOptionString("demuxer-lavf-o", "live_start_index=0,prefer_x_start=1,http_persistent=0")
        MPVLib.setOptionString("demuxer-seekable-cache", "yes")
        MPVLib.setOptionString("force-seekable", "yes")
        
        MPVLib.setOptionString("sub-auto", "fuzzy")
        MPVLib.setOptionString("sub-visibility", "yes")
        MPVLib.setOptionString("sub-font-size", "48")
        MPVLib.setOptionString("sub-pos", "100")
        MPVLib.setOptionString("sub-color", "#FFFFFFFF")
        MPVLib.setOptionString("sub-border-size", "3")
        MPVLib.setOptionString("sub-border-color", "#FF000000")
        MPVLib.setOptionString("sub-shadow-offset", "2")
        MPVLib.setOptionString("sub-shadow-color", "#80000000")
        
        MPVLib.setOptionString("osd-fonts-dir", "/system/fonts")
        MPVLib.setOptionString("sub-fonts-dir", "/system/fonts")
        MPVLib.setOptionString("sub-font", "Roboto")
        MPVLib.setOptionString("embeddedfonts", "yes")
        
        MPVLib.setOptionString("sub-codepage", "auto")
        
        MPVLib.setOptionString("blend-subtitles", "no")
        MPVLib.setOptionString("sub-use-margins", "yes")
        MPVLib.setOptionString("sub-ass-override", "force")
        MPVLib.setOptionString("sub-scale", "1.0")
        MPVLib.setOptionString("sub-fix-timing", "yes")
        
        MPVLib.setOptionString("osc", "no")
        MPVLib.setOptionString("osd-level", "1")
        
        MPVLib.setOptionString("sid", "auto")
        
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
        // Reset load event flag for new file
        hasLoadEventFired = false
        MPVLib.command(arrayOf("loadfile", url))
    }

    // Public API

    fun setDataSource(url: String) {
        if (isMpvInitialized) {
            // Headers were already set during initialization in initOptions()
            loadFile(url)
        } else {
            pendingDataSource = url
        }
    }

    fun setHeaders(headers: Map<String, String>?) {
        httpHeaders = headers
        Log.d(TAG, "Headers set: $headers")
    }

    private fun applyHttpHeadersAsOptions() {
        // Always set user-agent (this works reliably)
        val userAgent = httpHeaders?.get("User-Agent") 
            ?: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        
        Log.d(TAG, "Setting User-Agent: $userAgent")
        MPVLib.setOptionString("user-agent", userAgent)
        
        // Additionally, set other headers via http-header-fields if present
        // This is needed for streams that require Referer, Origin, Cookie, etc.
        httpHeaders?.let { headers ->
            val otherHeaders = headers.filterKeys { it != "User-Agent" }
            if (otherHeaders.isNotEmpty()) {
                // Format as comma-separated "Key: Value" pairs
                val headerString = otherHeaders.map { (key, value) -> "$key: $value" }.joinToString(",")
                Log.d(TAG, "Setting additional headers: $headerString")
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

    // Subtitle Styling Methods
    
    fun setSubtitleSize(size: Int) {
        if (isMpvInitialized) {
            Log.d(TAG, "Setting subtitle size: $size")
            MPVLib.setPropertyInt("sub-font-size", size)
        }
    }

    fun setSubtitleColor(color: String) {
        if (isMpvInitialized) {
            // MPV expects color in #AARRGGBB format, but we receive #RRGGBB
            // Convert to MPV format with full opacity
            val mpvColor = if (color.length == 7) "#FF${color.substring(1)}" else color
            Log.d(TAG, "Setting subtitle color: $mpvColor")
            MPVLib.setPropertyString("sub-color", mpvColor)
        }
    }

    fun setSubtitleBackgroundColor(color: String, opacity: Float) {
        if (isMpvInitialized) {
            // Convert opacity (0-1) to hex (00-FF)
            val alphaHex = (opacity * 255).toInt().coerceIn(0, 255).let { 
                String.format("%02X", it) 
            }
            // MPV format: #AARRGGBB
            val baseColor = if (color.startsWith("#")) color.substring(1) else color
            val mpvColor = "#${alphaHex}${baseColor.takeLast(6)}"
            Log.d(TAG, "Setting subtitle background: $mpvColor (opacity: $opacity)")
            MPVLib.setPropertyString("sub-back-color", mpvColor)
        }
    }

    fun setSubtitleBorderSize(size: Int) {
        if (isMpvInitialized) {
            Log.d(TAG, "Setting subtitle border size: $size")
            MPVLib.setPropertyInt("sub-border-size", size)
        }
    }

    fun setSubtitleBorderColor(color: String) {
        if (isMpvInitialized) {
            val mpvColor = if (color.length == 7) "#FF${color.substring(1)}" else color
            Log.d(TAG, "Setting subtitle border color: $mpvColor")
            MPVLib.setPropertyString("sub-border-color", mpvColor)
        }
    }

    fun setSubtitleShadow(enabled: Boolean, offset: Int) {
        if (isMpvInitialized) {
            Log.d(TAG, "Setting subtitle shadow: enabled=$enabled, offset=$offset")
            if (enabled) {
                MPVLib.setPropertyInt("sub-shadow-offset", offset)
                MPVLib.setPropertyString("sub-shadow-color", "#80000000")
            } else {
                MPVLib.setPropertyInt("sub-shadow-offset", 0)
            }
        }
    }

    fun setSubtitlePosition(pos: Int) {
        if (isMpvInitialized) {
            // sub-pos: 0=top, 100=bottom, can go beyond 100 for more offset
            // UI sends bottomOffset (0=at bottom, higher=more up from bottom)
            // Convert: MPV pos = 100 - (bottomOffset / screenHeightFactor)
            // Simplified: just pass pos directly, UI should convert
            Log.d(TAG, "Setting subtitle position: $pos")
            MPVLib.setPropertyInt("sub-pos", pos)
        }
    }

    fun setSubtitleDelay(delaySec: Double) {
        if (isMpvInitialized) {
            Log.d(TAG, "Setting subtitle delay: $delaySec seconds")
            MPVLib.setPropertyDouble("sub-delay", delaySec)
        }
    }

    fun setSubtitleScale(scale: Double) {
        if (isMpvInitialized) {
            Log.d(TAG, "Setting subtitle scale: $scale")
            MPVLib.setPropertyDouble("sub-scale", scale)
        }
    }

    fun setSubtitleAlignment(align: String) {
        if (isMpvInitialized) {
            // MPV sub-justify values: left, center, right, auto
            val mpvAlign = when (align) {
                "left" -> "left"
                "right" -> "right"
                "center" -> "center"
                else -> "center"
            }
            Log.d(TAG, "Setting subtitle alignment: $mpvAlign")
            MPVLib.setPropertyString("sub-justify", mpvAlign)
        }
    }

    fun setSubtitleBold(bold: Boolean) {
        if (isMpvInitialized) {
            Log.d(TAG, "Setting subtitle bold: $bold")
            MPVLib.setPropertyString("sub-bold", if (bold) "yes" else "no")
        }
    }

    fun setSubtitleItalic(italic: Boolean) {
        if (isMpvInitialized) {
            Log.d(TAG, "Setting subtitle italic: $italic")
            MPVLib.setPropertyString("sub-italic", if (italic) "yes" else "no")
        }
    }

    // Video Equalizer Methods

    fun setBrightness(value: Int) {
        brightnessVal = value
        if (isMpvInitialized) {
            Log.d(TAG, "Setting brightness: $value")
            MPVLib.setPropertyDouble("brightness", value.toDouble())
        }
    }

    fun setContrast(value: Int) {
        contrastVal = value
        if (isMpvInitialized) {
            Log.d(TAG, "Setting contrast: $value")
            MPVLib.setPropertyDouble("contrast", value.toDouble())
        }
    }

    fun setSaturation(value: Int) {
        saturationVal = value
        if (isMpvInitialized) {
            Log.d(TAG, "Setting saturation: $value")
            MPVLib.setPropertyDouble("saturation", value.toDouble())
        }
    }

    fun setGamma(value: Int) {
        gammaVal = value
        if (isMpvInitialized) {
            Log.d(TAG, "Setting gamma: $value")
            MPVLib.setPropertyDouble("gamma", value.toDouble())
        }
    }

    fun setHue(value: Int) {
        hueVal = value
        if (isMpvInitialized) {
            Log.d(TAG, "Setting hue: $value")
            MPVLib.setPropertyDouble("hue", value.toDouble())
        }
    }

    fun setGlslShaders(shaders: String?) {
        glslShadersVal = shaders
        if (isMpvInitialized) {
            Log.d(TAG, "Setting glsl-shaders: $shaders")
            MPVLib.setPropertyString("glsl-shaders", shaders ?: "")
        }
    }

    private fun applyPostInitSettings() {
        Log.d(TAG, "Applying post-init settings: B=$brightnessVal, C=$contrastVal, S=$saturationVal, G=$gammaVal, H=$hueVal, Shaders=$glslShadersVal")
        MPVLib.setPropertyDouble("brightness", brightnessVal.toDouble())
        MPVLib.setPropertyDouble("contrast", contrastVal.toDouble())
        MPVLib.setPropertyDouble("saturation", saturationVal.toDouble())
        MPVLib.setPropertyDouble("gamma", gammaVal.toDouble())
        MPVLib.setPropertyDouble("hue", hueVal.toDouble())
        
        glslShadersVal?.let {
            MPVLib.setPropertyString("glsl-shaders", it)
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
                // Only fire onLoad once when video dimensions are available
                // For HLS streams, duration updates incrementally as segments are fetched
                if (!hasLoadEventFired) {
                    val width = MPVLib.getPropertyInt("width") ?: 0
                    val height = MPVLib.getPropertyInt("height") ?: 0
                    // Wait until we have valid dimensions before firing onLoad
                    if (width > 0 && height > 0 && value > 0) {
                        hasLoadEventFired = true
                        Log.d(TAG, "Firing onLoad event: duration=$value, width=$width, height=$height")
                        onLoadCallback?.invoke(value, width, height)
                    }
                }
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
