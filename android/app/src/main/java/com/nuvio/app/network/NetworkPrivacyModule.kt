package com.nuvio.app.network

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class NetworkPrivacyModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NetworkPrivacyModule"

    @ReactMethod
    fun applyDohConfig(configMap: ReadableMap, promise: Promise) {
        try {
            val nextConfig = DoHConfig(
                enabled = configMap.getBooleanOrDefault("enabled", false),
                mode = configMap.getStringOrDefault("mode", DoHConfig.MODE_OFF),
                provider = configMap.getStringOrDefault("provider", DoHConfig.PROVIDER_CLOUDFLARE),
                customUrl = configMap.getStringOrDefault("customUrl", "")
            )

            DoHState.updateConfig(nextConfig)
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("DOH_APPLY_FAILED", "Failed to apply DoH configuration", error)
        }
    }

    @ReactMethod
    fun getDohConfig(promise: Promise) {
        try {
            val current = DoHState.currentConfig()
            val payload = Arguments.createMap().apply {
                putBoolean("enabled", current.enabled)
                putString("mode", current.mode)
                putString("provider", current.provider)
                putString("customUrl", current.customUrl)
            }
            promise.resolve(payload)
        } catch (error: Exception) {
            promise.reject("DOH_READ_FAILED", "Failed to read DoH configuration", error)
        }
    }

    private fun ReadableMap.getBooleanOrDefault(key: String, fallback: Boolean): Boolean {
        return if (hasKey(key) && !isNull(key)) getBoolean(key) else fallback
    }

    private fun ReadableMap.getStringOrDefault(key: String, fallback: String): String {
        return if (hasKey(key) && !isNull(key)) getString(key) ?: fallback else fallback
    }
}

