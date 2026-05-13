---
title: 'HCDE 351 | A4: 3D Printed Prototype: Toothpaste Squeezer'
date: 2026-02-15
summary: This process log documents the design of a toothpaste squeezer where the users can use the product to squeeze out the remaining contents from a nearly empty toothpaste tube or any nearly empty tube-like item.
tags:
  - 3D Printing
  - Computer Aided Design
draft: false
---

## Product Overview:

This process log documents the design of a toothpaste squeezer where the users can use the product to squeeze out the remaining contents from a nearly empty toothpaste tube or any nearly empty tube-like item. The goal of this design is to enhance functionality and usability, I hope this product can truly help me, allowing me to reuse many makeup items that I would have otherwise thrown away due to lack of proper use, making it more environmentally friendly. In this project, I practiced my skills of building a 3 dimensional product with technics of designing a product using a 3D modeling software, and also print it out to conduct the usertesting.

In this log, I will describe how I brainstormed based on defined user needs, made design decisions based on the evaluation criteria I made to determine if my product works, gathered feedback from users and peers, and identified parts that should be improved. I also document the reasoning behind key decisions and how these choices work better in supporting my target users.

## Ideation:

The goal of this design is to make a toothpaste squeezer which can be used in can be used to squeeze toothpaste and other tube-shaped items. In this section, I will explain how I iterate throughout these different ideas to better align with my design goal.

I started with thinking of my own pain point while squeezing toothpaste. I came up with these in my head.

**Painpoint:**

- **Sometimes I throw away a lot of toothpaste before it’s used up, because there’s no other way to squeeze it out.**

Before finding some ideas by gathering inspiration from Pinterest and thinking about how I can also stress the pain point using my design as a solution, I first came up with key design assumption and follow these criteria to make some design decisions.

**Key Design Assumption：**

> **_Feasibility:_** The gap and geometry between the PLA roller and the housing are sufficient to compress a standard toothpaste tube without slipping or tearing, while remaining operable with one hand.

**Design Decisions:**

> **The overall form is designed to support one-handed operation, with the roller positioned to allow continuous squeezing while stabilizing the housing against a flat surface.** This decision prioritizes testing whether the printed geometry provides sufficient leverage and stability during real use.**The spacing between the roller and the housing is intentionally constrained to fit standard toothpaste tubes, while allowing limited deformation of the tube material.** This decision tests dimensional tolerance and compression behavior that cannot be evaluated with low-fidelity prototypes.**The roller is designed as a separate printed component to allow rotation within the housing.** This enables us to conduct the evaluation of PLA contact friction, axle clearance, and whether rotation meaningfully reduces shear stress on the toothpaste tube.**Edges in contact with the toothpaste tube are rounded to reduce the risk of tearing during compression.** This decision addresses material interaction between a rigid printed object and a flexible consumer package.

After having sense of what product I will be designing. I started my sketches.

**Sketch 1–6:**

![](https://miro.medium.com/v2/resize:fit:1000/1*Qc1-sD6ExGeDOWA0Z3oEqg.png)

**Sketch 1–6**

In this section, I tried different ways of squeezing toothpaste. In the first sketch, I tried using a squeezer in the shape of a box, and then in the second sketch, I tried one squeezer without any other mechanisms. I felt that the structure might be a bit difficult to squeeze out, so I added some serrated structures in the third one. Then I thought I might need a clip structure to lock the two squeezer together, which is the origin of the fourth sketch. In the fifth sketch, I explored whether it would be possible to add a slider. Later, I found that adding a rotating handle inside the box would allow for the automatic squeezing of toothpaste.

**Sketch 7–9:**

![](https://miro.medium.com/v2/resize:fit:1000/1*2FRxIF5WkgRhpxnmB_ntsA.png)

**Sketch 7–9**

In this section, I continued to explore how to better automate the rotation to achieve a perfect toothpaste squeezing experience. I began by increasing the area where the hand holds the rotating handle, while also trying to modify the part that holds the toothpaste. In the end, I chose the ninth sketch that could accommodate more and hold the remaining part on top. (I think that one satisfy my design goal and my pain point the most)

## Prototype:

In the sections above, I explained how I established my evaluation criteria and made sure I know what product I am making, then I explored different ideas and then made decisions on the two I should go for making a paper prototype by following the design goal. In this section, I will briefly talk about the process of making two testable low-fidelity paper prototypes, and then use it to iterate to a better prototype in fidelity level (with CAD and 3D printing machines), and showcase how it looks.

![](https://miro.medium.com/v2/resize:fit:1000/1*zWEY7cNa346GpXzHcj-mBg@2x.jpeg)

Low-fi prototype

In this section, I explored the feasibility of this structure, simulated a flat object using a receipt, and verified an automated method by rotating the pen. Therefore, I decided to make the two parts separately in CAD software, then perform a slice model in priuser, and complete the 3D printing.

![](https://miro.medium.com/v2/resize:fit:4032/1*Frfx2C2oSme8WeOKsogbQQ@2x.jpeg)

![](https://miro.medium.com/v2/resize:fit:4032/1*RBQA-gExs8vmfM1_AH8Pvg@2x.jpeg)

3D Printing

![](https://miro.medium.com/v2/resize:fit:1000/1*z4RYD8NiZxhpXz5yyBdaHA@2x.jpeg)

Final design

![](https://miro.medium.com/v2/resize:fit:700/1*n84SKvZzT0a-ddTutoLzAA@2x.jpeg)

Final design (the other angel)

This is my final design, aligned with my design goal, passed the evaluation criteria, and satisfy my design decisions. The end of a toothpaste tube or any tube-like item can be inserted into the slot in the middle of the rotating handle, then both can be inserted into the large box. By rotating the handle, I can easily squeeze all the remaining toothpaste forward.

## Feedback:

In class, I leave my materials on the table, and getting sticky notes of critique. (at that moment, I don’t have the model yet, only the CAD view, that’s why my feedback is a bit weird). This is the feedback I received:

What works well?

- Strong concept / idea
- Clear thought and effort
- Attention to ergonomics & aesthetics
- Intentional design decisions

What could be better?

- Hard to evaluate without a physical prototype (now solved)
- Scale & fit are unclear
- Mechanism clarity
- Need clearer justification of choices

## Takeaways:

Feedback from both my peers and my TA reveal that my design did successfully align with my design goals and stress on the pain point as well as passing my criteria based on design decisions. But there this design have some minor issue that may or may not impact it functionality. It could be better if I,

- **built a quick physical prototype** so people can evaluate the size, comfort, and usability instead of guessing from CAD
- **clearly showed scale** (dimensions + photos in-hand / next to a toothpaste tube) to answer fit questions
- **tested with different hand sizes** and documented what changed based on that feedback

**Thanks for reading! : )**

## Technological Appendix:

**AI usage:**

- I used ChatGPT in correcting my grammar and typo;
- I used NotebookLM to help me organize user feedbacks;
- I discussed with ChatGPT of parts I should improve with the feedback I got.

**Writing reference:**

- I used the overall structure of the blog from my last blog as a reference of this blog. Some of the words written by myself are the same (some transition sentences and words).
- Here is my reference blog: [https://antaresyuan.site/blog/hcde-351-a2-soft-goods-prototype-shoulder-bag-design/](https://antaresyuan.site/blog/hcde-351-a2-soft-goods-prototype-shoulder-bag-design/)

**Inspirational reference:**

![](https://miro.medium.com/v2/resize:fit:488/1*hOmzHQXI4OuOs-eeCpZ6Ig.png)

[https://www.walmart.com/ip/Raindrops-3-Pcs-Squeeze-Toothpaste-Device-Squeezing-Tool-Roller-Dispenser-Child/16170971908?wmlspartner=wlpa&selectedSellerId=102489398&utm_source=Pinterest&utm_medium=organic](https://www.walmart.com/ip/Raindrops-3-Pcs-Squeeze-Toothpaste-Device-Squeezing-Tool-Roller-Dispenser-Child/16170971908?wmlspartner=wlpa&selectedSellerId=102489398&utm_source=Pinterest&utm_medium=organic)
