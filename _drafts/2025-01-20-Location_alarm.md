---
title:  "A location based alarm"
categories: projects
tags: android ios kotlin web kmm software location
---

# TLDR
I built an app to help me sleep on busses, and not miss my stop. 

# TSMIF (To short, more info required)
I love busses, and i love sleeping. Wouldn't it be great if i could combine these two loves, without missing my stop?

Yes, ok, apps for this exist already, but i thought it'd be fun to build one myself as a way of learning Kotlin Multiplatform Mobile (KMM). Did i mention i love maps too?

I also thought it'd be a good use case to play with watch apps, voice commands, and other such fun things you don't usually get to play with.

## Tech Stack
Kotlin Multiplatform Mobile (KMM), coupled with Jetpack Compose for Android and SwiftUI for IOS. This allows me to share the business logic while keeping a native look and feel to the apps. 

I mainly chose this as i wanted to branch out into IOS development in a friendlier way. Learning SwiftUI felt like less of a task than learning IOS development as a whole. That being said, i did still have to learn about the rest of it given i was interacting with various system services such as location, vibrations, dynamic island, notifications and widgets.

## What does it do?
Its a simple app, tap where you're going on the map, set a radius where you want to be woken up, and enable the alarm. The app will monitor your location and sound an alarm when you get inside the perimeter of your destination. Simples. 

## Complications
### Location in the background on IOS
I have experience of handling this on Android from my previous job, however i did have to learn how to achieve the same result on IOS - although i must say it was much more straightforward than all the hoops Android make you jump through with the foreground service stuff. 

### Playing audio and vibrating from the background on IOS
I went back and forth on my implementation for audio and vibrations as some don't work from the background. 

Specifically, for vibrations `Core Haptics` doesn't work from the background so I had to switch to use `AudioServices` instead.

For audio, i had to use an `AVAudioSession` to ensure the app was allowed to play music from the background. The `mixWithOthers` option was also required so as not to interfere with any audio that is already playing when enabling the alarm. 

### Shared view models on IOS
I initially struggled where to draw the line between shared code and platform specific. I initially started with platform specific view models, but eventually decided they were worth sharing as much as possible. I used [KMP Observable Viewmodel](https://github.com/rickclephas/KMP-ObservableViewModel) to allow kotlin viewmodels to be observed and reacted to on the swift side. 

Generally this worked ok, but i struggled with the instantiation of the viewmodel on the swift side when it had dependencies. Eventually i found this trick, which gets around the issue of not being able to directly instantiate the viewmodel where its being declared while still annotating it with `@StateViewModel` which is required for it to be reactive.
```swift
    @StateViewModel private var viewModel: SomeViewModel
    
    init(someDependency: SomeDepenency) {
        _viewModel = StateViewModel(
            wrappedValue: SomeViewModel(someDependency: someDependency)
        )
    }
```

As you can see, most of my complications came from the IOS side, which is to be expected since this is my first IOS project. The Android side was relatively pain free. 

## QA and Testing
I wanted this project to be a bit of a show piece, an ideal scenario app, where there were no deadlines and i could spend as much time on the details as i liked. 

One aspect i wanted to spend a lot of time on was QA, or rather, i wanted to spend a lot of time to remove the need for manual QA. To get to MVP, i was doing all ad-hoc manual testing, with unit tests for complicated logic, mainly in view models. However, once i'd reached MVP, i started looking into the world of UI testing. Having explored this multiple times before, and each time it had been a woefully painful experience, i was not looking forward to this task. However, even with the relatively simple set of [manual test cases](https://github.com/OliverCulleyDeLange/location-alarm/blob/main/QA.md) i had captured for the MVP app, QA testing was taking a non-trivial amount of time. 

Ideally i wanted a true continuous delivery pipeline where any change could be pushed out to prod assuming all tests pass, without the need for manual testing. This meant translating all the manual test cases into automated ones, and this immediately got complicated.

### QA Complications
My experience on the Android side of UI testing made me foresee complications with:
- Testing permissions
- Testing notifications
- Testing location updates
- Testing app behaviour when in the background
- Testing app behaviour when phone is locked
- Testing interactions with maps
- Testing sound and vibrations
- Testing dynamic island 
- Testing IOS Live Activities

After spending a long time trying to figure out the first item of testing permissions, i quickly lost motivation. Why was it so difficult to open the app under test with a given permission already denied? I moved onto trying to test notifications. Again, it seemed impossible to interact with the system notifications in any sensible way with `UIAutomator` - which appeared to be the only option. More motivation gone. 

I realised the reasons we decided to scrap UI testing in my old job were totally valid. Its a huge time sink, and not always worth it. 