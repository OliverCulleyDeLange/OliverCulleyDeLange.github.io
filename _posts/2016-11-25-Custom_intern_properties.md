---
title:  "Custom intern properties"
categories: Code-testing
tags: intern wiremock cors
---

You can define custom properties in your intern config file and access then by requiring intern `var intern = require('intern');`
 and using `intern.config.{propertyName}` to access the properties.

 This isn't obvious from the documentation but comes in handy when you need to dynamically set something based on the test config you're running.

 One example use case is if you're running functional tests against browsers on both your local machine and browsers on mobile devices where your web app uses CORS headers. You might need to set the `"Access-Control-Allow-Origin"` header on your stubbed server responses dynamically based on which test suite you're using due to the way mobile browsers access the intern proxy (through your machines IP).

###### Intern config for Mobile Browser functional testing
{% highlight javascript %}
define(function(require) {
    var ip = require('intern/dojo/node!ip')
    var ipaddress = ip.address();
    return {
        environments: [
            {
                platformName: "iOS",
                deviceName: "iPhone 6",
                browserName: "Safari",
                automationName: "XCUITest",
                platformVersion: "10.0"
            }
        ],
        tunnel: 'NullTunnel',
        tunnelOptions: {
            hostname: 'localhost', port: 4723
        },
        //Setting the Intern proxy url to be the IP on my computer to its accessible from the IOS Simulator
        proxyUrl: "http://" + ipaddress + ":9000/",
        proxyPort: 9000,
        functionalSuites: [ 'functionaltests/functional' ],

        // Custom intern property
        origin: "http://" + ipaddress + ":9000"
    }
});
{% endhighlight %}

###### Intern config for Desktop Browser functional testing
{% highlight javascript %}
define({
	environments: [
		{ browserName: 'chrome' }
	],
	tunnel: 'SeleniumTunnel',
	tunnelOptions: {
      drivers: [ 'chrome']
    },
	functionalSuites: [ 'functionaltests/functional' ],

    // Custom intern property
	origin: "http://localhost:9000"
});
{% endhighlight %}

###### Example wiremock module for stubbing out server responses using custom `origin` property for the value of the CORS header.

{% highlight javascript %}
define(function(require) {
    var request = require('intern/dojo/node!request');
    var intern = require('intern');

    return {
        stub: function (verb, url, status, response) {
            request.post(
            {
                url: 'http://localhost:1234/__admin/mappings',
                json: {
                      "request": {
                          "method": verb,
                          "url": url
                      },
                      "response": {
                            "status": status,
                            "body": response,
                            "headers": {
                                "Content-Type": "application/json",
                                "Access-Control-Allow-Origin": intern.config.origin,
                                "Access-Control-Allow-Credentials": "true"
                            }
                      }
                }
            },
            function (error, resp, body) {
                console.log("Stubbed " + verb + " call to " + url + ", will return " +
                status + " with body: " + response);
            })
        }
    }
});
{% endhighlight %}
