package com.nuvio.app.mpv

import android.graphics.Color
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter

class MpvPlayerViewManager(
    private val reactContext: ReactApplicationContext
) : SimpleViewManager<MPVView>() {

    companion object {
        const val REACT_CLASS = "MpvPlayer"
        
        // Commands
        const val COMMAND_SEEK = 1
        const val COMMAND_SET_AUDIO_TRACK = 2
        const val COMMAND_SET_SUBTITLE_TRACK = 3
    }

    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(context: ThemedReactContext): MPVView {
        val view = MPVView(context)
        // Note: Do NOT set background color - it will block the SurfaceView content
        
        // Set up event callbacks
        view.onLoadCallback = { duration, width, height ->
            val event = Arguments.createMap().apply {
                putDouble("duration", duration)
                putInt("width", width)
                putInt("height", height)
            }
            sendEvent(context, view.id, "onLoad", event)
        }
        
        view.onProgressCallback = { position, duration ->
            val event = Arguments.createMap().apply {
                putDouble("currentTime", position)
                putDouble("duration", duration)
            }
            sendEvent(context, view.id, "onProgress", event)
        }
        
        view.onEndCallback = {
            sendEvent(context, view.id, "onEnd", Arguments.createMap())
        }
        
        view.onErrorCallback = { message ->
            val event = Arguments.createMap().apply {
                putString("error", message)
            }
            sendEvent(context, view.id, "onError", event)
        }
        
        view.onTracksChangedCallback = { audioTracks, subtitleTracks ->
            val event = Arguments.createMap().apply {
                val audioArray = Arguments.createArray()
                audioTracks.forEach { track ->
                    val trackMap = Arguments.createMap().apply {
                        putInt("id", track["id"] as Int)
                        putString("name", track["name"] as String)
                        putString("language", track["language"] as String)
                        putString("codec", track["codec"] as String)
                    }
                    audioArray.pushMap(trackMap)
                }
                putArray("audioTracks", audioArray)
                
                val subtitleArray = Arguments.createArray()
                subtitleTracks.forEach { track ->
                    val trackMap = Arguments.createMap().apply {
                        putInt("id", track["id"] as Int)
                        putString("name", track["name"] as String)
                        putString("language", track["language"] as String)
                        putString("codec", track["codec"] as String)
                    }
                    subtitleArray.pushMap(trackMap)
                }
                putArray("subtitleTracks", subtitleArray)
            }
            sendEvent(context, view.id, "onTracksChanged", event)
        }
        
        return view
    }

    private fun sendEvent(context: ThemedReactContext, viewId: Int, eventName: String, params: com.facebook.react.bridge.WritableMap) {
        context.getJSModule(RCTEventEmitter::class.java)
            .receiveEvent(viewId, eventName, params)
    }

    override fun getExportedCustomBubblingEventTypeConstants(): Map<String, Any> {
        return MapBuilder.builder<String, Any>()
            .put("onLoad", MapBuilder.of("phasedRegistrationNames", MapBuilder.of("bubbled", "onLoad")))
            .put("onProgress", MapBuilder.of("phasedRegistrationNames", MapBuilder.of("bubbled", "onProgress")))
            .put("onEnd", MapBuilder.of("phasedRegistrationNames", MapBuilder.of("bubbled", "onEnd")))
            .put("onError", MapBuilder.of("phasedRegistrationNames", MapBuilder.of("bubbled", "onError")))
            .put("onTracksChanged", MapBuilder.of("phasedRegistrationNames", MapBuilder.of("bubbled", "onTracksChanged")))
            .build()
    }

    override fun getCommandsMap(): Map<String, Int> {
        return MapBuilder.of(
            "seek", COMMAND_SEEK,
            "setAudioTrack", COMMAND_SET_AUDIO_TRACK,
            "setSubtitleTrack", COMMAND_SET_SUBTITLE_TRACK
        )
    }

    override fun receiveCommand(view: MPVView, commandId: String?, args: ReadableArray?) {
        android.util.Log.d("MpvPlayerViewManager", "receiveCommand: $commandId, args: $args")
        when (commandId) {
            "seek" -> {
                val position = args?.getDouble(0)
                android.util.Log.d("MpvPlayerViewManager", "Seek command received: position=$position")
                position?.let { view.seekTo(it) }
            }
            "setAudioTrack" -> {
                args?.getInt(0)?.let { view.setAudioTrack(it) }
            }
            "setSubtitleTrack" -> {
                args?.getInt(0)?.let { view.setSubtitleTrack(it) }
            }
        }
    }

    // React Props

    @ReactProp(name = "source")
    fun setSource(view: MPVView, source: String?) {
        source?.let { view.setDataSource(it) }
    }

    @ReactProp(name = "paused")
    fun setPaused(view: MPVView, paused: Boolean) {
        view.setPaused(paused)
    }

    @ReactProp(name = "volume", defaultFloat = 1.0f)
    fun setVolume(view: MPVView, volume: Float) {
        view.setVolume(volume.toDouble())
    }

    @ReactProp(name = "rate", defaultFloat = 1.0f)
    fun setRate(view: MPVView, rate: Float) {
        view.setSpeed(rate.toDouble())
    }

    // Handle backgroundColor prop to prevent crash from React Native style system
    @ReactProp(name = "backgroundColor", customType = "Color")
    fun setBackgroundColor(view: MPVView, color: Int?) {
        // Intentionally ignoring - background color would block the TextureView content
        // Leave the view transparent
    }

    @ReactProp(name = "resizeMode")
    fun setResizeMode(view: MPVView, resizeMode: String?) {
        view.setResizeMode(resizeMode ?: "contain")
    }

    @ReactProp(name = "headers")
    fun setHeaders(view: MPVView, headers: com.facebook.react.bridge.ReadableMap?) {
        if (headers != null) {
            val headerMap = mutableMapOf<String, String>()
            val iterator = headers.keySetIterator()
            while (iterator.hasNextKey()) {
                val key = iterator.nextKey()
                headers.getString(key)?.let { value ->
                    headerMap[key] = value
                }
            }
            view.setHeaders(headerMap)
        } else {
            view.setHeaders(null)
        }
    }

    @ReactProp(name = "decoderMode")
    fun setDecoderMode(view: MPVView, decoderMode: String?) {
        view.decoderMode = decoderMode ?: "auto"
    }

    @ReactProp(name = "gpuMode")
    fun setGpuMode(view: MPVView, gpuMode: String?) {
        view.gpuMode = gpuMode ?: "gpu"
    }

    @ReactProp(name = "glslShaders")
    fun setGlslShaders(view: MPVView, glslShaders: String?) {
        view.setGlslShaders(glslShaders)
    }

    // Subtitle Styling Props

    @ReactProp(name = "subtitleSize", defaultInt = 48)
    fun setSubtitleSize(view: MPVView, size: Int) {
        view.setSubtitleSize(size)
    }

    @ReactProp(name = "subtitleColor")
    fun setSubtitleColor(view: MPVView, color: String?) {
        view.setSubtitleColor(color ?: "#FFFFFF")
    }

    @ReactProp(name = "subtitleBackgroundOpacity", defaultFloat = 0.0f)
    fun setSubtitleBackgroundOpacity(view: MPVView, opacity: Float) {
        // Black background with user-specified opacity
        view.setSubtitleBackgroundColor("#000000", opacity)
    }

    @ReactProp(name = "subtitleBorderSize", defaultInt = 3)
    fun setSubtitleBorderSize(view: MPVView, size: Int) {
        view.setSubtitleBorderSize(size)
    }

    @ReactProp(name = "subtitleBorderColor")
    fun setSubtitleBorderColor(view: MPVView, color: String?) {
        view.setSubtitleBorderColor(color ?: "#000000")
    }

    @ReactProp(name = "subtitleShadowEnabled", defaultBoolean = true)
    fun setSubtitleShadowEnabled(view: MPVView, enabled: Boolean) {
        view.setSubtitleShadow(enabled, if (enabled) 2 else 0)
    }

    @ReactProp(name = "subtitlePosition", defaultInt = 100)
    fun setSubtitlePosition(view: MPVView, pos: Int) {
        view.setSubtitlePosition(pos)
    }

    @ReactProp(name = "subtitleDelay", defaultFloat = 0.0f)
    fun setSubtitleDelay(view: MPVView, delay: Float) {
        view.setSubtitleDelay(delay.toDouble())
    }

    @ReactProp(name = "subtitleAlignment")
    fun setSubtitleAlignment(view: MPVView, align: String?) {
        view.setSubtitleAlignment(align ?: "center")
    }

    // Video Equalizer Props

    @ReactProp(name = "brightness", defaultInt = 0)
    fun setBrightness(view: MPVView, brightness: Int) {
        view.setBrightness(brightness)
    }

    @ReactProp(name = "contrast", defaultInt = 0)
    fun setContrast(view: MPVView, contrast: Int) {
        view.setContrast(contrast)
    }

    @ReactProp(name = "saturation", defaultInt = 0)
    fun setSaturation(view: MPVView, saturation: Int) {
        view.setSaturation(saturation)
    }

    @ReactProp(name = "gamma", defaultInt = 0)
    fun setGamma(view: MPVView, gamma: Int) {
        view.setGamma(gamma)
    }

    @ReactProp(name = "hue", defaultInt = 0)
    fun setHue(view: MPVView, hue: Int) {
        view.setHue(hue)
    }
}
