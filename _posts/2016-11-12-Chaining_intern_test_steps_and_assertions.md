---
title:  "Chaining intern test steps and assertions"
categories: Code-testing
tags: intern
---

The appeal of using Intern for functional testing web apps, was the easy setup and use of the 'SeleniumTunnel' which means you don't have to manually install Selenium to your machine - intern takes care of all this for you.

However, I'm not a big fan of Interns test framework for controlling the web driver. I say Intern - I mean Leadfoot, which is the interface Intern uses to talk to Selenium. I'm not a javascript man and the way leadfoot uses promises didn't click naturally with me.

The below is an example of the best way I've found to structure multiple assertions on multiple elements. Its not pretty, and I don't like it - so if anyone knows a better way - let me know!

{% highlight javascript %}
define(function (require) {
    var bdd = require('intern!bdd');
    var expect = require('intern/chai!expect');

    bdd.describe('some screen', function () {

        bdd.before(function(){
            this.remote.setFindTimeout(5000);
        });

        bdd.it('should set the right background image', function () {
            return this.remote
                .get(require.toUrl('index.html'))
                .then(doSomeStuff())
                .findAllByClassName('thing-you-wanna-check-styling-for')
                .then(function(listOfElements){
                    return listOfElements[0].getComputedStyle('background-image');
                })
                .then(function(classes) {
                    expect(classes).to.contain('someImage.svg')
                })
                .end()
                .findAllByClassName('another-thing-you-wanna-check-styling-for')
                .then(function(listOfElements){
                    return listOfElements[1].getComputedStyle('background-image');
                })
                .then(function(classes) {
                    expect(classes).to.contain('someImage.svg')
                })
                .end()
        });

    });

// Using the suggested helper pattern to do repeatable actions instead of page objects, which in my experience gets messy.
    function doSomeStuff() {
        return function () {
            return this.parent
                .findById('thing-you-wanna-click')
                    .click()
                    .type("some words")
                    .end()
        }
    }

});
{% endhighlight %}

