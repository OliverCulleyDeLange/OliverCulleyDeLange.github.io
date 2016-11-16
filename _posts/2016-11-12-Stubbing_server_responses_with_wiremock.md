---
title:  "Stubbing server responses with wiremock for functional testing a web app"
categories: testing
tags: intern wiremock
---

If, like me, you want to run functional tests against a stub server, or fake server as some call it, the easiest way I've found is to simply start a [wiremock](http://wiremock.org/) server in standalone mode before running your tests.

- Download the wiremock standalone jar from [Maven](http://central.maven.org/maven2/com/github/tomakehurst/wiremock-standalone/2.3.1/wiremock-standalone-2.3.1.jar)
- In whatever build tool you're using, ensure you start wiremock before your functional tests run. I'm using NPM as a build tool so my `package.json` looks a bit like this:

{% highlight json %}
{
  "scripts": {
    "prefunc-web": "npm run fakes",
    "func-web": "intern-runner config=functionaltests/intern-web",
    "postfunc-web": "npm run killfakes",

    "fakes": "nohup java -jar ./functionaltests/wiremock-standalone-2.3.1.jar --port 1234 --root-dir wiremock > wiremock.log &",
    "killfakes": "curl -X POST http://localhost:1234/__admin/shutdown"
  },
  "devDependencies": {
    ...
  }
}

{% endhighlight %}

NPM is often overlooked as a build tool, and the `pre` and `post` hooks here are very useful. They allow tasks to be dependent on other tasks or arbitrary commands, simply by adding the right prefix. So `pretest` will always run before the `test` script. Similarly `posttest` will always run after. I'm using these hooks here to start the wiremock fake server before executing my tests.

#### Canned wiremock responses

The `--root-dir wiremock` flag is being used here to point the fake server to some pre-canned responses that are setup in that directory. This can be useful for local testing, but could also be used in functional tests, although I wouldn't recommend this as its usually best to set up your state in the test, rather than rely on global expected state such as these canned responses.

 For example, in `/wiremock/mappings/default.json`

{% highlight json %}
{
  "priority": 10,
  "request": {
    "method": "ANY",
    "urlPattern": ".*"
  },
  "response": {
    "status": 200,
    "headers": {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    "jsonBody": {
      "someResponseProperty": "some response value",
      "someListOfThings": [{
        "ohLook": "a thing"
      }]
    },
    "fixedDelayMilliseconds": 2000
  }
}
{% endhighlight %}

Here we are defining a default response that wiremock will return in response to any request. You can change the `urlPattern` property to make it specific to a single endpoint in your stubbed out API. For example `"urlPattern": "/resource/thing"` would mean wiremock would only respond with the defined response when `http://localhost:1234/resource/thing` is called.