---
title:  "A Cross Platform Memory Game"
categories: projects
tags: android ios kotlin web kmm software game
---

# TLDR
Spent a day building a simple memory game with KMM + Compose on all platforms. It was easy. 

## TSMD (Too short, more detail)
During my 2024-2025 careers break (the 3rd one 😅), I found myself in the mountains in the USA with a bit of time on my hands. I'd been working on [Location Alarm](https://github.com/OliverCulleyDeLange/location-alarm) for a while, and felt like a change.

Having recently turned 30, I became somewhat paranoid about my lack of ability to remember anything over a 6 digit number. When a website sent me a OTP I'd often fail to enter it first time. I thought, maybe all the fancy tools in modern phone OS' which automatically enter OTPs from your messages have broken my memory. Or maybe i'm just getting old. Or both?

Either way, I wanted to do some memory training, specifically for numbers. I downloaded a bunch of number memory trainer apps, but none were exactly what I wanted. One i tried called 25 would give you a 3 second countdown before each level, which i found to be the most frustrating thing in the world (clearly i was having a bad day). Another thing i didn't like was it would wait for you to get the right answer before moving on. Ok there was a 'give up' option, but it slowed down the whole process. 

I was about to hop on a flight from the east to west coast of the US and decided to start my own version.

## Improvements
The main thing i wanted to improve is practice efficiency. No waiting, no animations, instant feedback. I also wanted to adjust the levelling automatically to allow continuous play without restarting levels etc. The basic algorithm is: `if ya pass, add a digit, if ya fail, remove one`. This makes your average (median) score the interesting metric for whether you're improving over time. 

Eventually, i might persist the scores and draw a pretty progress graph. Later though. 

## Tech stack
My previous project, `Location Alarm` was Kotlin Multiplatform Mobile (KMM), but used native design systems. So Compose on Android and SwiftUI on IOS. I did this because i wanted to learn a bit of IOS development. This was fine, but i quickly got frustrated with having to re-write all the UI twice. I knew you could in theory use Compose on both platforms, so i decided to check that out in this project. I was also curious about web support, allowing writing the same UI for Android, IOS and Web. 

Turns out for a simple project like this, its fantastic. 

At the time of writing this article, i'd consider it done (at least to MVP standards). In total (spread over a few different days) i spent a little less than an average work day (~8 hours) writing the code. 


## Deploying
I haven't bothered deploying the mobile apps to their respective stores, because currently i can't face the thought of forking out $99 per year to publish some hobbyist app i built for fun. 

However, the web version is deployed to [Github Pages](https://oliverdelange.co.uk/memory-kmm-compose/) - and that was very straightforward using a [Github Action](https://github.com/OliverCulleyDeLange/memory-kmm-compose/blob/main/.github/workflows/main.yml) that i copied from a medium article and pasted shamelessly into my IDE. 


## Challenges and downsides
Honestly, this project was the most straightforward i've ever undertaken. Yes, its probably the simplest too, so there's that. Everything kind of 'just worked'. 

One big downside is that the ios app looks _very_ Androidy. I don't care for this pet project, but i think i would if it was something i was planning to release. Obviously you can design your way out of this, but i couldn't be bothered for this project, and used stock colors and components - hence it looks pretty un-pretty. 

# Demo Video
<video muted autoplay controls>
    <source src="{{ site.url }}/assets/video/memory-kmm-compose-demo.mp4" type="video/mp4">
</video>