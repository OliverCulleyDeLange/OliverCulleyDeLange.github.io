---
title:  "Accessing elasticache redis from AWS Java Lambda + Cloudformation"
categories: Code-cloud
tags: aws elasticache lambda nat-gateway vpc cloudformation java
---

I had real trouble trying to find tutorials, or even solid documentation on how to get this setup, and even more trouble getting the Cloudformation scripts to match what I hacked together through the AWS console.

AWS's documentation is very comprehensive, but its also confusing and you have to trawl through so many different tutorials/api documentation/FAQs to get all the information you need. I must have easily spent a good 8 hours reading documentation, forums, stackoverflow and tutorials, and another 8 hours piecing it all together.

So if this post helps someone in my situation - mission acomplished.

#### Examples and tutorials

The best AWS tutorial I found was by AWS, which details [how to setup a Lambda function through the cli, that has access to an Elasticache cluster](http://docs.aws.amazon.com/lambda/latest/dg/vpc-ec.html). This gave me the basics on how I should go about setting everything up in the AWS console.

This is a good example of [getting Elasticache setup through cloudformation](https://github.com/satterly/AWSCloudFormation-samples/blob/master/VPC_ElastiCache_Cluster.template). However they're using EC2 instances to connect to the elasticache cluster, not Lambda which adds a whole other layer of complexity.

#### Lambdas, Elasticache and VPCs

Before introducing Elasticache, my Lambda functions weren't running in a VPC. As far as I can tell, a Lambda function can't access an Elasticache cluster without being run inside a VPC, and being part of a security group that is has access to the cluster. The [Elasticache FAQs](https://aws.amazon.com/elasticache/faqs/#Security) confuse me somewhat, so I can't say with with 100% certainty.

>All clients to a cluster must be within the EC2 network, and authorized via security groups.`

 The above snippet is taken from the FAQs, and [this stack overflow post](http://stackoverflow.com/questions/27759026/connect-to-elasticache-cluster-from-aws-lambda-function) also backs up this theory.

 Basically I think it boils down to:

`If you're using a Lambda to access your cluster, you must execute the Lambda inside the same VPC that contains your Elasticache cluster, and authorise the security group that the lambda function uses to access the cluster.`

So I had to make my Lambdas run inside a VPC. This means creating all the Cloudformation scripts to configure the VPC, associated subnets, routing tables, internet gateways, nat gateways and associations between all these components!

I also had to add the `VpcConfig` property to my existing `Lambda::Function` cloudformation config:

```
"VpcConfig": {
    "SecurityGroupIds": [ { "Fn::GetAtt": ["lambdasSecurityGroup", "GroupId"] } ],
    "SubnetIds": [{ "Ref": "subnetPrivate" }]
 }
```

Then add a `ManagedPolicyArns` property to the Lambda Functions `IAM::Role` configuration:

```
"ManagedPolicyArns": [
    "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
]
```

#### NAT Gateways for outbound internet access

One headache for me was figuring out that I needed a NAT Gateway because Lambdas running inside a VPC lose their default internet access. My Lambda connects to DynamoDB, which is accessible only via a URL through the internet.  The docs say to attach your Lambda function to a `Private subnet with Internet access through a NAT instance or an Amazon VPC NAT gateway`. So thats what I did.

#### Cloudformation troubleshooting

Initially I created the Elasticache redis cluster first, then tried to add the VPC configuration on top of this. I came accross the following error:

> The provided security group {security group id} does not exist.

This confused me because I could clearly see the security groups being created successfully further down the events list.
I spent so long on this, that I actually [raised it on the AWS forums](https://forums.aws.amazon.com/thread.jspa?threadID=243255) (something I never do!). In the end it turned out that I wasn't creating my Elasticache cluster inside my VPC, but the error message was no help at all! Check the forum post for details.


#### Final Cloudformation Json

Its worth pointing out that my actual cloudformation stack json contains alot more than what is below - but these are the bits that are relevant to this post.

{% highlight json %}
    "vpc": {
      "Type": "AWS::EC2::VPC",
      "Properties": {
        "CidrBlock": "192.168.0.0/24",
        "Tags": [
          {
            "Key": "Name",
            "Value": "VPC"
          }
        ]
      }
    },
    "natGatewayElasticIP": {
      "Type": "AWS::EC2::EIP",
      "Properties": {
        "Domain": "vpc"
      }
    },
    "natGateway": {
      "Type": "AWS::EC2::NatGateway",
      "Properties": {
        "AllocationId": {
          "Fn::GetAtt": ["natGatewayElasticIP", "AllocationId"]
        },
        "SubnetId": {
          "Ref": "subnetPublic"
        }
      }
    },
    "internetGateway": {
      "Type": "AWS::EC2::InternetGateway",
      "Properties": {
      }
    },
    "attachInternetGateway": {
      "Type": "AWS::EC2::VPCGatewayAttachment",
      "Properties": {
        "VpcId": {
          "Ref": "vpc"
        },
        "InternetGatewayId": {
          "Ref": "internetGateway"
        }
      }
    },
    "routeTablePrivate": {
      "Type": "AWS::EC2::RouteTable",
      "Properties": {
        "VpcId": {
          "Ref": "vpc"
        }
      }
    },
    "routeToNatGateway": {
      "Type": "AWS::EC2::Route",
      "Properties": {
        "RouteTableId": {
          "Ref": "routeTablePrivate"
        },
        "DestinationCidrBlock": "0.0.0.0/0",
        "NatGatewayId": {
          "Ref": "natGateway"
        }
      }
    },
    "routeTablePublic": {
      "Type": "AWS::EC2::RouteTable",
      "Properties": {
        "VpcId": {
          "Ref": "vpc"
        }
      }
    },
    "routeToInternetGateway": {
      "Type": "AWS::EC2::Route",
      "Properties": {
        "RouteTableId": {
          "Ref": "routeTablePublic"
        },
        "DestinationCidrBlock": "0.0.0.0/0",
        "GatewayId": {
          "Ref": "internetGateway"
        }
      }
    },
    "subnetPublic": {
      "Type": "AWS::EC2::Subnet",
      "Properties": {
        "VpcId": {
          "Ref": "vpc"
        },
        "CidrBlock": "192.168.0.0/26",
        "Tags": [
          {
            "Key": "Name",
            "Value": "Public Subnet"
          }
        ]
      }
    },
    "subnetPrivate": {
      "Type": "AWS::EC2::Subnet",
      "Properties": {
        "VpcId": {
          "Ref": "vpc"
        },
        "CidrBlock": "192.168.0.128/26",
        "Tags": [
          {
            "Key": "Name",
            "Value": "Private Subnet"
          }
        ]
      }
    },
    "subnetPublicRouteTableInternetGateway": {
      "Type": "AWS::EC2::SubnetRouteTableAssociation",
      "Properties": {
        "SubnetId": {
          "Ref": "subnetPublic"
        },
        "RouteTableId": {
          "Ref": "routeTablePublic"
        }
      }
    },
    "subnetPrivateRouteTableNatGateway": {
      "Type": "AWS::EC2::SubnetRouteTableAssociation",
      "Properties": {
        "SubnetId": {
          "Ref": "subnetPrivate"
        },
        "RouteTableId": {
          "Ref": "routeTablePrivate"
        }
      }
    },
    "lambdaSecurityGroup": {
      "Type": "AWS::EC2::SecurityGroup",
      "Properties": {
        "GroupDescription": "Allows access into redis if lambda uses this group",
        "VpcId": {
          "Ref": "vpc"
        }
      }
    },
    "redisClusterSecurityGroup": {
      "Type": "AWS::EC2::SecurityGroup",
      "Properties": {
        "GroupDescription": "Secures the Elasticache cluster",
        "VpcId": {
          "Ref": "vpc"
        },
        "SecurityGroupIngress": [
          {
            "IpProtocol": "tcp",
            "FromPort": "6379",
            "ToPort": "6379",
            "SourceSecurityGroupId": {
              "Ref": "lambdaSecurityGroup"
            }
          }, {
            "IpProtocol": "udp",
            "FromPort": "6379",
            "ToPort": "6379",
            "SourceSecurityGroupId": {
              "Ref": "lambdaSecurityGroup"
            }
          }
        ]
      }
    },
    "cacheSubnetGroup": {
      "Type": "AWS::ElastiCache::SubnetGroup",
      "Properties": {
        "Description": "Elasticache redis subnet group",
        "SubnetIds": [
          {
            "Ref": "subnetPrivate"
          }
        ]
      }
    },
    "redis": {
      "Type": "AWS::ElastiCache::CacheCluster",
      "Properties": {
        "CacheNodeType": "cache.t1.micro",
        "Engine": "redis",
        "NumCacheNodes": "1",
        "CacheSubnetGroupName": {
          "Ref": "cacheSubnetGroup"
        },
        "VpcSecurityGroupIds": [
          {
            "Ref": "redisClusterSecurityGroup"
          }
        ]
      }
    },
{% endhighlight%}
