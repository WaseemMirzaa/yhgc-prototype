package com.app.yhgc

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class YhgcApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Portfolio alerts",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Updates from your YHGC adviser"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "yhgc_alerts"
    }
}
