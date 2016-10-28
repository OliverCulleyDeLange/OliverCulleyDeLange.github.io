---
layout: post
title:  "Unlocking an Android Emulator with a pin lock set - appium & mitmdump"
date:   2016-10-25 12:12:59 +0100
categories: android appium testing
---

When running Appium tests against Android Lollipop (API 22) (5.1), you might need to unlock the device using a passcode or password. My use case was using [mitmdump](https://mitmproxy.org/) to proxy traffic from the emulator to my locally running backend service. In order to do this, you need to install a root certificate on the emulator, which requires you to set a pin / password. On Android Marshmallow (API 23 ) (6.0), it allows you to immediately take this off, however Lollipop doesn't.

The easiest way I found to unlock the emulator before running tests against it is to run the below shell commands through [Jenkins](https://jenkins.io) just before we kick off the tests. 

{% highlight bash %}
adb shell input keyevent KEYCODE_MENU
adb shell input keyevent KEYCODE_9
adb shell input keyevent KEYCODE_9
adb shell input keyevent KEYCODE_9
adb shell input keyevent KEYCODE_9
adb shell input keyevent KEYCODE_ENTER
{% endhighlight %}

Obviously, substituting the KEYCODE values for your pin / password. 

There's a complete list of KeyCode values here: <https://developer.android.com/reference/android/view/KeyEvent.html>