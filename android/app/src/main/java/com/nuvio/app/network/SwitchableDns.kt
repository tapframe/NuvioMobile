package com.nuvio.app.network

import okhttp3.Dns
import java.net.InetAddress
import java.net.UnknownHostException

object SwitchableDns : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
        val activeConfig = DoHState.currentConfig()
        if (!activeConfig.enabled || activeConfig.mode == DoHConfig.MODE_OFF) {
            return Dns.SYSTEM.lookup(hostname)
        }

        val dohDns = DoHState.currentDoHDns()
        if (dohDns == null) {
            return when (activeConfig.mode) {
                DoHConfig.MODE_STRICT -> {
                    throw UnknownHostException("DoH is enabled in strict mode, but resolver configuration is invalid.")
                }
                else -> Dns.SYSTEM.lookup(hostname)
            }
        }

        return try {
            dohDns.lookup(hostname)
        } catch (error: Exception) {
            if (activeConfig.mode == DoHConfig.MODE_STRICT) {
                val wrapped = UnknownHostException("DoH lookup failed in strict mode for $hostname")
                wrapped.initCause(error)
                throw wrapped
            }
            Dns.SYSTEM.lookup(hostname)
        }
    }
}

