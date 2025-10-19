---
title: "Schengen Days Calculator"
categories: projects
tags: web software vibe coding travel schengen visa 
---

## Schengen Days Calculator - Free forever!

[Schengen Calculator](https://oliverdelange.co.uk/schengen-calculator/) is my latest project designed to help travelers easily plan their trips within the Schengen Area. The tool makes it simple to track your days and ensure you stay within the 90/180 rule.

![schengen calculator mvp]({{ site.url }}/assets/images/schengen/mvp.png)

### Why I Built It
As a frequent traveler to Europe, I need to keep track of my days.
I was happily using the Schengen app on IOS, but suddenly they decided to start charging a subscription for it. Whaaaat???

Anything that i feel like i can vibe code in a day, i'm absolutely not going to pay for. 

I looked for alternatives, but only found a bunch of disgusting 90's looking websites like [this](https://www.visa-calculator.com/) and [this](https://ec.europa.eu/assets/home/visa-calculator/calculator.htm?lang=en). 

### MVP Features
- **Simple date entry:** Add your trip dates and see your remaining days. Overstay days are highlighted in red. Minimal taps to enter dates.
- **No sign-up:** Your data stays on your device, specifically i store the trip dates in indexedDb

### UX design philosophy
I hate fluff, websites that are 10% functionality and 90% pictures and words telling you obvious things about the functionality. 

On this occasion, i assumed that if you need a Schengen days calculator, you're already aware of the rules, and just want to calculate the numbers as quickly as possible. 

Hence, there's zero fluff here, just pure full screen functionality (ok there's an info popup), but its an after thought, and hidden unless you arrive on the page and are confused.

I built this for myself mainly, but if others find it useful, then... cool

### Tech stack
Pure HTML, CSS and JS... ew. Nah but for something like this why complicate things?
Pure vibe coding too. If i was writing the code myself, or it was a larger project i'd use TS for sure. 

### Try It Out
Visit [Schengen Calculator](https://oliverdelange.co.uk/schengen-calculator/) and give it a go, all feedback welcomed. 
