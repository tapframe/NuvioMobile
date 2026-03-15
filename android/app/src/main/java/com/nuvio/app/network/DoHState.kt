package com.nuvio.app.network

import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps
import java.net.InetAddress
import java.util.concurrent.TimeUnit
import android.content.Context
import com.tencent.mmkv.MMKV
import org.json.JSONObject

private data class DoHProviderDefinition(
    val url: String,
    val bootstrapHosts: List<String>
)

object DoHState {
    private const val SETTINGS_KEY = "app_settings"
    private const val USER_CURRENT_KEY = "@user:current"

    private val providerDefinitions = mapOf(
        DoHConfig.PROVIDER_CLOUDFLARE to DoHProviderDefinition(
            url = "https://cloudflare-dns.com/dns-query",
            bootstrapHosts = listOf("1.1.1.1", "1.0.0.1")
        ),
        DoHConfig.PROVIDER_GOOGLE to DoHProviderDefinition(
            url = "https://dns.google/dns-query",
            bootstrapHosts = listOf("8.8.8.8", "8.8.4.4")
        ),
        DoHConfig.PROVIDER_QUAD9 to DoHProviderDefinition(
            url = "https://dns.quad9.net/dns-query",
            bootstrapHosts = listOf("9.9.9.9", "149.112.112.112")
        )
    )

    private val bootstrapClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var config: DoHConfig = DoHConfig()

    @Volatile
    private var dohDns: Dns? = null

    /**
     * Initializes DoH configuration from MMKV storage.
     * Call this during app onCreate to ensure "Instant-On" protection.
     */
    fun initializeFromStorage(context: Context) {
        try {
            // Initialize MMKV if not already done
            MMKV.initialize(context)
            val mmkv = MMKV.defaultMMKV() ?: return

            // 1. Determine current scope (multi-user support)
            val scope = mmkv.decodeString(USER_CURRENT_KEY) ?: "local"
            val scopedSettingsKey = "@user:$scope:$SETTINGS_KEY"

            // 2. Try to read settings from scoped key, fallback to legacy
            val settingsJson: String? = mmkv.decodeString(scopedSettingsKey) ?: mmkv.decodeString(SETTINGS_KEY)
            
            settingsJson?.let { jsonString ->
                val json = JSONObject(jsonString)
                
                val nextConfig = DoHConfig(
                    enabled = json.optBoolean("dnsOverHttpsEnabled", false),
                    mode = json.optString("dnsOverHttpsMode", DoHConfig.MODE_AUTO) ?: DoHConfig.MODE_AUTO,
                    provider = json.optString("dnsOverHttpsProvider", DoHConfig.PROVIDER_CLOUDFLARE) ?: DoHConfig.PROVIDER_CLOUDFLARE,
                    customUrl = json.optString("dnsOverHttpsCustomUrl", "") ?: ""
                )
                
                updateConfig(nextConfig)
            }
        } catch (e: Exception) {
            // Fallback to default (Off) on any error
        }
    }

    @Synchronized
    fun updateConfig(nextConfig: DoHConfig) {
        val normalized = normalize(nextConfig)
        config = normalized
        dohDns = buildDoHDns(normalized)
    }

    fun currentConfig(): DoHConfig = config

    fun currentDoHDns(): Dns? = dohDns

    private fun normalize(input: DoHConfig): DoHConfig {
        val normalizedMode = when (input.mode) {
            DoHConfig.MODE_OFF, DoHConfig.MODE_AUTO, DoHConfig.MODE_STRICT -> input.mode
            else -> DoHConfig.MODE_OFF
        }

        val normalizedProvider = when (input.provider) {
            DoHConfig.PROVIDER_CLOUDFLARE,
            DoHConfig.PROVIDER_GOOGLE,
            DoHConfig.PROVIDER_QUAD9,
            DoHConfig.PROVIDER_CUSTOM -> input.provider
            else -> DoHConfig.PROVIDER_CLOUDFLARE
        }

        val trimmedCustomUrl = input.customUrl.trim()

        return if (!input.enabled || normalizedMode == DoHConfig.MODE_OFF) {
            DoHConfig(
                enabled = false,
                mode = DoHConfig.MODE_OFF,
                provider = normalizedProvider,
                customUrl = if (normalizedProvider == DoHConfig.PROVIDER_CUSTOM) trimmedCustomUrl else ""
            )
        } else {
            DoHConfig(
                enabled = true,
                mode = normalizedMode,
                provider = normalizedProvider,
                customUrl = if (normalizedProvider == DoHConfig.PROVIDER_CUSTOM) trimmedCustomUrl else ""
            )
        }
    }

    private fun buildDoHDns(config: DoHConfig): Dns? {
        if (!config.enabled || config.mode == DoHConfig.MODE_OFF) {
            return null
        }

        val dohUrl = resolveDoHUrl(config) ?: return null
        val builder = DnsOverHttps.Builder()
            .client(bootstrapClient)
            .url(dohUrl)
            .resolvePrivateAddresses(true)
            .includeIPv6(true)

        val bootstrapHosts = resolveBootstrapHosts(config)
        if (bootstrapHosts.isNotEmpty()) {
            builder.bootstrapDnsHosts(*bootstrapHosts.toTypedArray())
        }

        return builder.build()
    }

    private fun resolveDoHUrl(config: DoHConfig) = when (config.provider) {
        DoHConfig.PROVIDER_CUSTOM -> config.customUrl.toHttpUrlOrNull()
        else -> providerDefinitions[config.provider]?.url?.toHttpUrlOrNull()
    }

    private fun resolveBootstrapHosts(config: DoHConfig): List<InetAddress> {
        val provider = providerDefinitions[config.provider] ?: return emptyList()
        return provider.bootstrapHosts.mapNotNull { host ->
            try {
                InetAddress.getByName(host)
            } catch (_: Exception) {
                null
            }
        }
    }
}
