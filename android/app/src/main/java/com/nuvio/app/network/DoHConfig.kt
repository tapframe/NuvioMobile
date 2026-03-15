package com.nuvio.app.network

data class DoHConfig(
    val enabled: Boolean = false,
    val mode: String = MODE_OFF,
    val provider: String = PROVIDER_CLOUDFLARE,
    val customUrl: String = ""
) {
    companion object {
        const val MODE_OFF = "off"
        const val MODE_AUTO = "auto"
        const val MODE_STRICT = "strict"

        const val PROVIDER_CLOUDFLARE = "cloudflare"
        const val PROVIDER_GOOGLE = "google"
        const val PROVIDER_QUAD9 = "quad9"
        const val PROVIDER_CUSTOM = "custom"
    }
}

