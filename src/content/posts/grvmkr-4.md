---
date: 2025-05-31
title:  "GrvMkr: User Experience on Mobile and Shareability"
categories: projects
tags: ["web", "software", "percussion", "drumming", "samba", "ux", "user-experience"]
---

# TLDR
Made <a href="https://oliverdelange.co.uk/grvmkr/">GrvMkr</a> into a mobile-friendly Progressive Web App (PWA) with a bunch of new features.

![Theme toggle](/assets/images/grvmkr/4/theme.png)


# TSGM (Too Short, Gimme More)
Since the <a href="https://oliverdelange.co.uk/projects/GrvMkr_3/">last update</a>, I’ve been focusing on user experience and turning this into a tool fit for real-world use. Often, my personal projects don’t have real users — but that has changed now.

Aside from my mum (the catalyst for this project), a local samba band leader got in touch and requested some features. I was surprised that people were starting to use the tool in real life, and I already knew of a number of shortcomings I wanted to fix:

- **Mobile-friendliness, or lack of**  
  While GrvMkr kind of worked on mobile, it was hard, fiddly, and felt restrictive compared to desktop.

- **Sharable grooves UX**  
  Grooves were technically sharable, but the sound files weren’t bundled with the groove. The importer had to fetch the samples separately, adding friction.

- **Groove file management**  
  The only way to manage groove files was to download and manually organize them. Wouldn’t it be nice if they all saved automatically to your browser? Yes.

Interestingly, the requested feature wasn’t on that list — they wanted **instrument volume controls**.

# Mute, Solo, and Volume Controls
I set a few design constraints:

- Volume controls should be easily accessible during playback and editing
- They should be small and unobtrusive
- They should work intuitively on desktop and mobile

This meant they should live in the grids, not in the instrument configuration section. That, I was certain of.

The rest, I wasn’t so sure about. In music production software (DAWs), M = Mute and S = Solo. I borrowed this convention — it’s not perfect for non-audio folks, but worst case, it's pretty clear what those buttons do, and they’re reversible, so I wasn’t too worried.

![Initial mute and solo design](/assets/images/grvmkr/4/mute_solo.png)

For volume controls, I wanted to KISS (Keep It Simple, Stupid). I started with just a percentage, like `80%`, inside the first-row cell alongside the instrument name, mute, and solo buttons.

![Initial volume control design - Too simple](/assets/images/grvmkr/4/volume_initial.png)

You could drag that number left/down to decrease or right/up to increase. Technically it worked, but it wasn’t visually clear what `80%` meant.

So I went with a simple triangle shape — an outline filled with green based on volume percentage.

![Volume controls with filled triangle](/assets/images/grvmkr/4/volume_triangles.png)

This, plus the number, is draggable to adjust volume. I had a mobile UX issue where the system scroll interfered — solved with a quick `event.preventDefault()` in `onpointerdown`.

## Multi-cell Selection + Copy and Paste
As mentioned in my last blog post, a lot of samba grooves reuse patterns across instruments. Manually inputting these is painful — copy/paste was essential. But what’s the best UX for that on mobile?

Luckily, I had guinea pigs to test on and someone close to me who recently studied UX/UI.

### Multi-cell Selection
Photo apps like Apple Photos and Google Photos offer decent multi-select UIs. Apple requires tapping a 'Select' button first. Google Photos lets you long-press for ~500ms, then drag across images.

I prefer Google’s approach — it feels more natural.

I couldn’t work out why Google didn’t allow immediate press-and-drag horizontally. Their photos aren’t horizontally scrollable, so the gesture is available. Maybe because you can select in both directions?

Anyway, GrvMkr's MVP only supports selecting cells within a single row, so I ditched the hold delay. It feels nice and natural.

### Copy and Paste
Originally, I implemented copy/paste via keyboard shortcuts — dumb assumption, considering today’s mobile usage.

For mobile, I added it to the “cell tools” bar, which already had options like merge/unmerge and hit type.

This worked... *okay*. But for larger grids, the tools were off-screen, and scrolling often caused accidental selections. Bad UX.

I fixed this by **pinning** the cell toolbar to the bottom of the screen while the grid is visible.

Here’s a video demonstrating multi-select and copy/paste:

<video width="222" height="480" controls>
  <source src="{{ '/assets/video/grvmkr_grv_building.mp4' | relative_url }}" type="video/mp4">
  Your browser does not support videos, sorry.
</video>

# Progressive Web App (PWA)
I’d heard of PWAs years ago but never played with them. The idea is: build a web app you can “install” on a mobile device. Cool — let’s try it.

There are a few hoops to jump through: a manifest, icons, etc. Nothing ChatGPT couldn’t help with.

Initial impressions weren’t great. The install process is unclear. If you don’t know about PWAs, you probably won’t figure it out — and you can’t even add a proper install button, since there's no direct API for that. You just have to explain it somewhere in your UI. I didn’t bother.

On iOS, it's even more hidden. Only Safari can install PWAs — urgh.

The only real benefit: easy home-screen access and no browser UI in your face.

![PWA vs In Browser experience](/assets/images/grvmkr/4/pwa.png)

Interesting learning experience. Not worth the effort.

# Local File Save
A simple but necessary feature: two new main menu buttons — “New” and “My Grooves.”

Pretty self-explanatory, with one UX caveat I’ve been thinking about:  
**“If I press New, will I lose my work?”**  

Valid question, especially since there’s no “Save” button.

Hopefully users will see the “Save to file” button and use it before pressing New. Then they might check “My Grooves” to see if anything was lost — and discover their previous groove, safely saved.

Not perfect UX, but good enough for now.

![My Grooves view](/assets/images/grvmkr/4/my_grooves.png)

# Toggle Light and Dark Theme
I added this mainly to test both themes without fiddling with macOS system settings.

It also makes people aware of the theme toggle — some might prefer a different mode than their system default. Personally, I’m always in dark mode, and I much prefer GrvMkr that way.

![Theme toggle](/assets/images/grvmkr/4/theme.png)

# Bundle Audio Files with Groove Files
Previously, saving a groove created a big JSON file — grid structure, instruments, etc. But audio samples weren’t included, so importing required re-adding the audio files manually. Boo.

Imagine a band leader sharing grooves with their group — they’d have to send a bunch of files separately. Ew.

![Missing audio file error](/assets/images/grvmkr/4/missing_audio_file.png)

Bad experience — caused by MVP shortcuts. Time to fix it.

Now, instead of saving just a JSON file, I wrap it in a ZIP with an `audio/` folder containing the samples. I rename the zip to `.grv` — just for fun.

![.grv file structure](/assets/images/grvmkr/4/grv_zip_structure.png)

Now `.grv` files include everything — structure **and** audio. Import one and everything just works. Nice.

# Play File Like an Arrangement
The final feature — heavily requested by my *entire* user base of two people 😅 — was to play groove files as a full arrangement.

Now, you can string together sections (intro → bridge → main groove) and play them back in sequence, no ninja-timed button pressing required.

# Final Word
I’ve really been enjoying working on GrvMkr lately. It’s been a fun pet project — but now, other people are using it and getting value from it. That’s incredibly rewarding.
