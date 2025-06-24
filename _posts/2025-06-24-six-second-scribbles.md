---
title:  "Six Second Scribbles - Web Version"
categories: projects
tags: web software game vibe coding drawing
---

# TLDR
Reproduced a fun drawing game using AI in about 60 minutes: <a href="https://oliverdelange.co.uk/6ss/">6 Second Scribbles</a>

![6 second scribbles]({{ site.url }}/assets/images/6ss/6ss.png)


# More plz
While visiting family in Sweden, my cousin started doodling on a piece of paper. It reminded me of a fun game I once played called 6 Second Scribbles. It's a card game where you pick a card that lists 10 items to draw in 60 seconds (6 seconds per item). Points are awarded for correct guesses—both to the guesser and the drawer. There are three difficulty levels: easy, medium, and hard. We spent hours—and many sheets of paper—playing this game in the pub. 

In Sweden, I wanted to play it with my cousin but didn’t have the cards.

What I did have was a laptop and a GitHub Copilot trial. So, I decided to see if I could quickly recreate the game cards using AI.

"Hey Copilot, do you know the game 6 Second Scribbles? Make me a web version of it using basic HTML and CSS."

Ten minutes (and a bit of tweaking) later, I had a working MVP and deployed it to GitHub Pages.


# Game play
We played a few rounds to test it out. The easy cards were great fun, but the medium and hard ones were total nonsense. My favorite example of a questionable card was this:

```json
{ category: "Famous Composers", items: ["Mozart", "Beethoven", "Bach", "Chopin", "Tchaikovsky", "Handel", "Vivaldi", "Haydn", "Schubert", "Liszt"] },
```

Unless you're a classical music fanatic, you're unlikely to be able to distinguish these composers with a 6-second scribble.

# Fixes
A few days later, I revisited the MVP and explained the problem to Copilot. It did... alright. But ChatGPT was much better at understanding and fixing the “hard-to-draw” items.

After that, I quickly added a `How to Play` section, a 60-second countdown timer, and a fun flashing background with an alarm sound when the timer ends.

Done.

