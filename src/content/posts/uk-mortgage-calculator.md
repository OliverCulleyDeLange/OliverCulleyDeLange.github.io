---
date: 2026-06-29
title: "UK Mortgage Calculator"
categories: projects
tags: ["web", "mortgage", "uk", "calculator", "personal-finance"]
description: "A UK mortgage calculator that answers the actual questions — what term fits my budget, and how much interest am I really paying?"
---

Every bank's mortgage calculator gives you one number: "your monthly payment is £X". Useful as a sanity check, but it's the wrong shape for the questions I actually had. *How does that number change if I stretch the term? What's a realistic mortgage to even aim for on my salary? At what point is one extra year actually worth it?*

So I built one that answers a few more.

[Have a play →](/mortgage-calculator/)

### Salary in, mortgage out

You can type a mortgage amount and rate directly, or you can punt your salary and deposit at the top of the page and let it guess. 4.5× salary for the loan, 35% of gross monthly for a comfortable payment budget — the usual UK rules of thumb. Everything downstream re-renders to match.

The default interest rate updates monthly from Bank of England figures, so it's roughly what you'd get on a 3-year fix at 75% LTV right now. Sitting at 4.88% as I'm writing this.

### Two charts

The top one plots monthly payment vs term length on the left axis, total lifetime interest on the right axis, and stacked translucent bars at every term showing the split between average monthly principal and average monthly interest. The bar tops match the blue line. The orange chunk is the bit that's painful — at a 40-year term it's well over half of every monthly payment.

The second is the amortization schedule for whichever term you've picked: how each month's payment splits between capital and interest over the life of the loan. Early on it's nearly all interest. Five years into a 25-year mortgage you're still mostly paying interest. The point where capital finally overtakes interest is the chart's most quietly depressing feature.

### The budget bit

Both curves on the top chart are monotonic — shorter term always means less interest *and* more per month, full stop. So there's no actual "sweet spot" to point at. What's useful is the marginal trade-off at the point where you're standing.

Drop a monthly budget into the form and the calculator finds the shortest term that fits, draws a horizontal line at your budget across the chart, and prints two sentences underneath:

> Stretching to N+1 years would add £X in interest for only £Y/mo less.  
> Shortening to N–K years would cost £X/mo more (~10% of budget) and save £Z in interest.

Those are the "is one more year of headroom actually worth it?" and "what would meaningfully cut my total cost?" questions, which is the real conversation you have when working out what to put on a mortgage application.

### Caveats

UK mortgages don't actually have fixed rates for the whole term. You fix for 2–5 years and then either re-fix at whatever rates exist then, or drop onto the lender's standard variable rate. The curves aren't predictions, they're planning tools. Real lenders also add fees, stress-test affordability, and don't always lend you 4.5× anyway. Don't make a life decision off this thing.

But do feel free to use it to decide whether a particular property is worth booking a viewing for.
