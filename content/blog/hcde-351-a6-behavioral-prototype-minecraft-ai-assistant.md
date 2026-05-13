---
title: 'HCDE 351 | A6: Behavioral Prototype: Minecraft AI Assistant'
date: 2026-03-01
summary: This process log documents the behavioral prototype of a game strategy assistant which can help user making decision while playing the games by chatting with them in real-time.
tags:
  - Behavioral Prototyping
draft: false
---

![](https://miro.medium.com/v2/resize:fit:700/1*FyeCGSdlBZDw7mX6SWIGnw.png)

The problem

## Product Overview:

This process log documents the behavioral prototype of a game strategy assistant which can help user making decision while playing the games by chatting with them in real-time. The goal of this behavioral prototype is to test out functionality and usability, where we can set up a use case where user may interact with the system, with a limited cost and fast pace of iteration. In this project, I practiced my skills of making a behavioral prototype by brainstorm the solution that we can "mock of", conducting the user testing session to check if the interaction make sense and try not to let the user notice that.

In this log, I will describe how I brainstormed with my teammates based on scenario setting we chose, set up the system and test environment, gathered feedback from users and peers, and identified parts that should be improved. I also document the reasoning behind key decisions and how these choices work better in supporting my prototype.

## Ideation:

The goal of this design is to make a behavioral prototype that can be used in testing a use case where the user need to interact with the system, helping the designer quickly see how the user may interact with the system and making design decisions of how to iteration to the next step. In this section, I will explain how we brainstorm the behavioral prototype which aligned with our design goal.

The topic I pick is "Applications for a voice-operated assistant". We started brainstorming the use case ourself which need a voice-operated assistant or encounter in our daily usage. We came up with these in my head.

**Usage of Voice-Operated Assistant:**

- **I had a Amazon Alexa in my home where I use it to listen to some morning news, popular music, and as a bot to chat with me (Also it is pretty stupid).**
- **I sometimes chat with a LLM like ChatGPT to ask some questions that I cannot explain well using only a few sentences.**
- **I asked the Siri in my phone to set up alarm clock and check the files in my phone.**
- **I used AI agent to help me analyze the decision I made during League of Legend, and what led to a defeat in a game.**

We found out that the one that most interested us is the last one which is using AI to help with decision making during game.

**Product：**

> An AI assistant which can be used during a LOL game to help you analyze the BP of the game, which decision should be made at this moment, and how should I do to win the game, by talking with me verbally.

After meeting with the teaching team, talking about our idea, we got several feedback and then head up towards our behavioral prototype design.

**System:**

![](https://miro.medium.com/v2/resize:fit:700/1*RZg8jrgYtkIjL5JpYvtrGw.png)

System diagram

Moving from the first idea, we decided to do a game that requires less knowledge in playing and easy to mock up (well to mock up an assistant that can help you play LOL is way much harder). We decided to move to Minecraft and one of our teammate will use a voice-changer to pretend to be the assistant, creating a black box where the participant may not know this case and test out our voice-based assistant system.

## Prototype:

In the sections above, I explained how we made sure we know what scenario we are designing for, then we explored ideas and then push to the final design that we should go for by following the design goal. In this section, I will briefly talk about what our final prototype is with the testing video.

Final behavioral prototype

[https://youtu.be/bi4GBexMFOQ](https://youtu.be/bi4GBexMFOQ)

Final behavioral prototype

![](https://miro.medium.com/v2/resize:fit:700/1*UKlDYnML2WTXmdYBPVJQLw.png)

Brief intro of our design

We conducted user testing in Minecraft using a Wizard-of-Oz methodology to simulate a coach-type voice assistant and examine users’ trust and decision-making behavior in an open-ended environment. Participants were informed that the assistant would provide strategic evaluation and directional guidance such as prioritization, risk assessment, base selection, or design direction. But would not function as a tutorial system. It did not explain game mechanics, give crafting recipes, or provide step-by-step instructions. We structured testing around three scenarios (early survival setup, creative building, and cave/ruins exploration) and observed how users formulated questions, adjusted their strategies based on coaching feedback, and reacted when procedural or technical questions were declined. The goal was to evaluate how authoritative, strategy-focused guidance influences player confidence and behavioral reliance without removing agency.

## Feedback:

In class, we had a group feedback discussion. This is the feedback I received:

What works well?

- \*\*Real-time feedback felt valuable.\*\* Our participant explicitly appreciated getting immediate feedback, which suggests the interaction loop is fast enough to support “in-the-moment” decision-making.
- \*\*Fast, natural voice interaction.\*\* They liked that the assistant responded quickly, understood the question, and matched their situation.
- \*\*Peers saw clear use cases.\*\* The demo critique included comments like _“I_can see how this can help to understand user focus,_”_ which signals our value proposition landed: the prototype communicates potential and relevance even at this stage.
- \*\*Believability is already there.\*\* Both participant + peers found it believable, meaning our concept and interaction style are convincing enough to imagine in a real product.

What could be better?

- \*\*Answer accuracy / domain knowledge (core weakness).\*\* The participant’s main complaint is the most critical one: if it’s “not knowledgeable in the game,” trust drops fast.
- \*\*Clarity of functions (mental model mismatch).\*\* One peer didn’t understand what the prototype _does_ or how it responds.
- \*\*Background operation + privacy comfort.\*\* The “does it run in the background?” concern is a UX and ethics flag
- \*\*Data collection strategy needs to be explicit.\*\* The critique implies uncertainty about what the system tracks and how it infers “user focus.”

## Takeaways:

Feedback from both my peers and my TA reveal that our design did successfully align with my design goals and stress on the pain point as well as following my scenario. But there this design have some minor issue that may or may not impact it functionality. It could be better if we,

- improved the accuracy of the voice assistant’s responses by incorporating more game-specific knowledge and contextual data.
- clarified the prototype’s functionality through better onboarding and clearer feedback states (e.g., listening, processing, responding).
- addressed privacy concerns by clearly explaining whether the system runs in the background and giving users control over data collection.
- improved transparency around how user focus is detected and what data is being collected.

**Thanks for reading! : )**

## Technological Appendix:

**AI usage:**

- I used ChatGPT in correcting my grammar and typo;
- I used NotebookLM to help me organize user feedbacks;
- I discussed with ChatGPT of parts I should improve with the feedback I got.

**Writing reference:**

- I used the overall structure of the blog from my last blog as a reference of this blog. Some of the words written by myself are the same (some transition sentences and words).
- Here is my reference blog: [https://antaresyuan.site/blog/hcde-351-a2-soft-goods-prototype-shoulder-bag-design/](https://antaresyuan.site/blog/hcde-351-a2-soft-goods-prototype-shoulder-bag-design/)
