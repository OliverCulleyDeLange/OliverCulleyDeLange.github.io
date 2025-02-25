---
title:  "Kotlin Multiplatform on Apple Watch"
categories: projects
tags: ios kotlin multiplatform apple watch watchos
---

# TLDR
Figured out how to run shared Kotlin (KMM) code on an apple watch. There was a frustrating lack of information out there, so now its here. 

# But Why!?
I've been working on a little learning project called [Location Alarm](https://github.com/OliverCulleyDeLange/location-alarm) for a while now, and its up and running on ios and android, using a shared kotlin module for the main logic, and native ui (jetpack compose / swift ui). Its basically a location based alarm clock so i can fall asleep on busses and not miss my stop. Yes, i could go to bed earlier but... 🤷‍♂️

I wanted to add watch apps for both eco-systems, and since i actually have an apple watch i started there. 

## Step 1: Creating a wearOS target
I followed the [official apple tutorial](https://developer.apple.com/tutorials/swiftui/creating-a-watchos-app) but i'll provide a TLDR here:
- In XCode: File > New > Target. 
- Select 'watchOS' tab then select the 'App' template and click Next.
- Fill out the 'Product Name` 
- Select 'Watch App for Existing iOS App' and ensure your app is selected
  - Sidenote, initially my app didn't show. Restarting XCode fixed this. 

You should now be able to run the sample watch app. 

## Step 2: Shared Gradle Configuration
If you try to `import Shared` in your watch app now, you'll get a  `No such module 'Shared'` error

1. Add the following to your shared `build.gradle.kts` file:
```kotlin
watchosX64(),
watchosArm64(),
watchosSimulatorArm64()
```

For example:
```kotlin
    val iosTargets = listOf(
        iosX64(),
        iosArm64(),
        iosSimulatorArm64()
    )
    val appleWatchTargets = listOf(
        watchosX64(),
        watchosArm64(),
        watchosSimulatorArm64()
    )
    (iosTargets + appleWatchTargets).forEach { iosTarget ->
        iosTarget.binaries.framework {
            baseName = "Shared"
            isStatic = true
        }
    }
```

2. Sync Gradle project

## Step 3: XCode Build Configuration

- Go into `iosApp` target -> Build Phases -> Compile Kotlin Framework, and copy the shell script from there. Mine is below, but yours may be different so its best to copy from your own project. 
    - ```
        if [ "YES" = "$OVERRIDE_KOTLIN_BUILD_IDE_SUPPORTED" ]; then
        echo "Skipping Gradle build task invocation due to OVERRIDE_KOTLIN_BUILD_IDE_SUPPORTED environment variable set to \"YES\""
        exit 0
        fi
        cd "$SRCROOT/.."
        ./gradlew :shared:embedAndSignAppleFrameworkForXcode
        ```

- Now switch to the `{Project Name} Watch App` target -> Build Phases -> Click the + icon -> Select `New run script phase` to add a new script build phase. 
- Paste the script in, and rename the phase (double click the name) to something more sensible than `Run script`
- Now drag the new phase to the top of the custom phases (they're the ones with the bin icon to the right)

This runs the `embedAndSignAppleFrameworkForXcode` gradle task as part of the Watch App's build.

## Step 4: Disable User Script Sandboxing
If you run now, you'll likely see an error like `You have sandboxing for user scripts enabled.`

To fix this: 
- Go into `{Project name} Watch App` target -> Build Settings, and search for `Sandbox`
- In 'Build Options', set `User Script Sandboxing` to `No`

## Step 5: Xcode Build Settings
**Note**: _I'm not entirely sure if this step is required. It seemed to be when i was originally figuring everything out. However, when i reverted everything, and followed this guide to check it, the watch app worked after step 4, so you may not need this._

Now we're generating the framework as part of the build process, we now need to tell XCode where it lives. 

- Go into `{Project name} Watch App` target -> Build Settings, and search for `Framework Search Paths`
- Double click the empty space where the values go
- Click the + icon on the popup
- Add the following two entries in this order
  - `$(inherited)`
  - `$(SRCROOT)/../shared/build/xcode-frameworks/$(CONFIGURATION)/$(SDK_NAME)`

Now XCode knows to look in the shared kotlin build directory for the frameworks, which are now generated as part of the watch build process. 
