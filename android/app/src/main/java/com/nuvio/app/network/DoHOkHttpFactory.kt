package com.nuvio.app.network

import android.content.Context
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient

class DoHOkHttpFactory(
    private val appContext: Context
) : OkHttpClientFactory {
    override fun createNewNetworkModuleClient(): OkHttpClient {
        return OkHttpClientProvider.createClientBuilder(appContext)
            .dns(SwitchableDns)
            .build()
    }
}

