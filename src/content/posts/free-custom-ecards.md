---
date: 2026-10-04
title: "Free Custom Ecards: Making Group Cards Less Rubbish"
categories: projects
tags: ["web", "software", "ecards", "nextjs", "supabase", "realtime"]
description: "Building a collaborative ecard maker with real art, live group signing and email delivery."
---

# TLDR

I built [Free Custom Ecards](https://oliverdelange.co.uk/ecard/), originally called Artycards. It lets you choose some art, customise a card, invite a group of people to sign it together, and send the result by email. It is free while I build it.

# Why?

I've signed a lot of group ecards over the years. They solve a real problem: people are spread across different homes, offices and countries, but everyone can still write something in the same card.

The convenience is great. The actual cards often aren't.

A lot of them lean heavily on clip art, novelty fonts and templates that feel like they were designed for an office birthday in 2009. The nicest physical cards are usually the opposite: you find some artwork you genuinely like, often made by an independent artist, and sending it feels personal.

I wanted to keep the useful group-signing bit of an ecard, but make the card itself feel more like that.

# How it works

You start by choosing artwork or using your own photo. The editor presents a proper folded card rather than a flat message board. You can add text and emoji, move and resize everything, change the paper colour, and flip between the cover and the inside.

The important bit is collaboration. The person making the card can create signing links and pass them around. Signers don't need an account; they open their link, add their message and mark themselves as done. Changes appear for everyone working on the card, so it feels closer to a tiny shared design tool than a form that eventually becomes a card.

When everybody is finished, the creator enters the recipient's details and the ecard arrives by email. The recipient gets a read-only 3D version that opens, closes and rotates in the browser.

# Supporting artists

The original idea was called Artycards because I wanted the gallery to be made up of work from real illustrators and artists. Artists can apply, upload their work and manage it through their own studio. Artwork is stored privately and served through the app, so the clean original isn't exposed directly.

Cards are free while I'm building the platform. If I add payments later, the aim is for artists to receive most of the price whenever their work is sent. The platform should exist to help distribute their art, not swallow the value of it.

# Tech stack

This became a much more substantial project than I expected:

- **Next.js** for the app and server-rendered card pages
- **Supabase** for authentication, Postgres, storage and realtime events
- **Cloudflare Workers** for hosting
- **Server-sent events** to carry persistent updates into the editor
- A small object-based editor where every message, emoji and image has its own position, size and author

The collaboration model is deliberately pragmatic. Postgres is the durable source of truth, while quick peer updates make dragging and editing feel immediate. Each object uses last-write-wins conflict handling. That isn't how I'd build collaborative source control, but it is absolutely fine for a birthday message and a dancing banana emoji.

# The unexpectedly complicated bits

Sending an ecard sounds simple until it includes login, anonymous signers, private images, live editing, delivery emails and retries that must not send the same card twice.

The 3D card also has two jobs that pull in opposite directions. It should feel physical when someone opens it, but editing text on a dramatically tilted CSS object is horrible. The compromise is a flat, accurate editing surface with a 3D presentation wrapped around it.

Email delivery needed similar care. A card is only really sent once the delivery flow has completed, and retrying a slow request must not create another order or email the recipient twice. It is the sort of boring edge case that suddenly becomes the most important feature once real people use the app.

# What's next

The big ambition is still physical cards: design and sign one together online, then have a printed copy arrive through the post. Printing, packing and postage add rather more complexity than sending an email, so I'm starting with the digital version.

For now, you can [make a free custom ecard](https://oliverdelange.co.uk/ecard/) and tell me what is missing.
