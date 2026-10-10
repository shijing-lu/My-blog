package com.byqx.core.network
import org.junit.Assert.*
import org.junit.Test

class ServerAddressTest {
    @Test fun acceptsHttpsAndNormalizesTrailingSlash() {
        assertEquals("https://example.test:8443/", ServerAddress.normalize(" https://example.test:8443 ", false))
    }
    @Test fun restrictsDebugHttpToExplicitLoopbackHosts() {
        assertEquals("http://127.0.0.1:4321/", ServerAddress.normalize("http://127.0.0.1:4321", true))
        for (raw in listOf("http://example.test", "http://127.0.0.1.evil.test", "https://user:pass@example.test", "https://example.test/api", "https://example.test?token=secret", "https://example.test#x", "file:///tmp", "https://example.test:70000")) {
            assertThrows(IllegalArgumentException::class.java) { ServerAddress.normalize(raw, true) }
        }
        assertThrows(IllegalArgumentException::class.java) { ServerAddress.normalize("http://127.0.0.1:4321", false) }
    }
}
