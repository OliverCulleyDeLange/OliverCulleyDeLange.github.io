---
title:  "We Climb Rocks"
categories: projects
tags: work android software climbing
---

# TLDR
I built an Android app to allow creating and sharing climbing topos (route maps). I never released it, but it was a fun learning experience and ultimately got me my first Android job. 

# TSGM (To short, gimme more)
Between 2015 and 2020 (on and off) I was tinkering with a personal project I called WeClimb.Rocks. I'm cheap, and hate spending money. Climbing guidebooks cost money. I thought if they were crowdsourcable it'd make them free. 

Now i know a lot of work goes into creating guidebooks, and i do appreciate that, however, it shouldn't need to be a lot of work. Ultimately, its a picture, and some lines drawn on, with some extra information about the grade of those lines and maybe how many bolts there are if you're lucky. 

At the time, there were topo apps, like [27 crags](https://27crags.com/) and topo websites like [thecrag](https://thecrag.com), but none of them allowed the community to submit high quality topos easily (emphasis on the easily part), and none enabled doing that via an app.

So i built it. 

## V1 - Java
This started as the output of training course at my first job. I was a backend java engineer, and they were trying to upskill and retrain us as mobile devs for ... reasons. I really enjoyed the course, and you could say it was the original catalyst for my becoming a mobile developer. 

The code is private on gitlab (back when they were the only ones offering free private repos), but i mothballed and reignited the project over the years so many times, eventually kotlin was the new kid on the block. Hence I decided to re-write it, again with a view to up-skilling.

The java only version was relatively feature complete though (albeit ugly), and there's a gif showing what it could do:

![V1Demo]({{ site.url }}/assets/images/wcr/wcr-java.gif)

# V2 - Kotlin
The [Kotlin version](https://github.com/OliverCulleyDeLange/wcr-android-kt) added some boring but vital functionality such as:
- Allowing multiple topos per image
- Search for crags, sectors and climbs
- Login to upload
  
Otherwise it was much the same, just with a revamped tech stack.

# Server
Of course, given you could upload and share topos, there was a server running to accommodate this. Again, on GitLab, but it was a simple Java + Spring Boot which handled auth and uploading and syncing locations (crags and sectors) and topos. It was hosted on Heroku, and the topo images were hosted in Cloudinary as a heroku add-on.

# Mothballing
After i'd built what i thought was the MVP, i went traveling for a while and ignored the project for a couple of months. Afterwards, covid happened and i decided i should probably get a job since the world was going into lockdown. 

I used this project to attempt to switch discipline and become a mobile developer, and it worked!

Ultimately though, it wasn't just the new job that made me mothball the project for the final time, it was also:
 - I didn't want to create/maintain a new database of climbing routes. There's enough out there already (27 crags, thecrag.com, rockfax, climb around, etc) and the community doesn't need more fragmentation. I did contact a few of them to see if i could integrate with their backend and use and add to their climbing route database, but you can imagine the responses (or lack of). The crag.com did get back to me, but they're building their own cross-platform app and didn't want the overheads of integrating with another app of questionable origin.
- I wasn't sure about the legalities of uploading existing routes that are present in other paid for guidebooks. Would this be some sort of plagiarism?
- This project started as a way for me to learn Android development and I never really intended of releasing it, hence no tests and sometimes scrappy development.
- Since its only Android, I'm missing half the world, and new cross platform frameworks like flutter and react native are becoming better and better. I could re-write but the idea simply isn't worth investing any more time into.

# Demo Video
<video muted autoplay controls width="320">
    <source src="{{ site.url }}/assets/video/wcr-kt-demo.webm" type="video/mp4">
</video>