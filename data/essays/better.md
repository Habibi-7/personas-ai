---
title: "Better Bayesian Filtering"
slug: better
url: https://www.paulgraham.com/better.html
---

# Better Bayesian Filtering

January 2003  
  
_(This article was given as a talk at the 2003 Spam Conference. It describes the work I've done to improve the performance of the algorithm described in [A Plan for Spam](spam.html), and what I plan to do in the future.)_  
  
The first discovery I'd like to present here is an algorithm for lazy evaluation of research papers. Just write whatever you want and don't cite any previous work, and indignant readers will send you references to all the papers you should have cited. I discovered this algorithm after \`\`A Plan for Spam'' \[1\] was on Slashdot.  
  
Spam filtering is a subset of text classification, which is a well established field, but the first papers about Bayesian spam filtering per se seem to have been two given at the same conference in 1998, one by Pantel and Lin \[2\], and another by a group from Microsoft Research \[3\].  
  
When I heard about this work I was a bit surprised. If people had been onto Bayesian filtering four years ago, why wasn't everyone using it? When I read the papers I found out why. Pantel and Lin's filter was the more effective of the two, but it only caught 92% of spam, with 1.16% false positives.  
  
When I tried writing a Bayesian spam filter, it caught 99.5% of spam with less than .03% false positives \[4\]. It's always alarming when two people trying the same experiment get widely divergent results. It's especially alarming here because those two sets of numbers might yield opposite conclusions. Different users have different requirements, but I think for many people a filtering rate of 92% with 1.16% false positives means that filtering is not an acceptable solution, whereas 99.5% with less than .03% false positives means that it is.  
  
So why did we get such different numbers? I haven't tried to reproduce Pantel and Lin's results, but from reading the paper I see five things that probably account for the difference.  
  
One is simply that they trained their filter on very little data: 160 spam and 466 nonspam mails. Filter performance should still be climbing with data sets that small. So their numbers may not even be an accurate measure of the performance of their algorithm, let alone of Bayesian spam filtering in general.  
  
But I think the most important difference is probably that they ignored message headers. To anyone who has worked on spam filters, this will seem a perverse decision. And yet in the very first filters I tried writing, I ignored the headers too. Why? Because I wanted to keep the problem neat. I didn't know much about mail headers then, and they seemed to me full of random stuff. There is a lesson here for filter writers: don't ignore data. You'd think this lesson would be too obvious to mention, but I've had to learn it several times.  
  
Third, Pantel and Lin stemmed the tokens, meaning they reduced e.g. both \`\`mailing'' and \`\`mailed'' to the root \`\`mail''. They may have felt they were forced to do this by the small size of their corpus, but if so this is a kind of premature optimization.  
  
Fourth, they calculated probabilities differently. They used all the tokens, whereas I only use the 15 most significant. If you use all the tokens you'll tend to miss longer spams, the type where someone tells you their life story up to the point where they got rich from some multilevel marketing scheme. And such an algorithm would be easy for spammers to spoof: just add a big chunk of random text to counterbalance the spam terms.  
  
Finally, they didn't bias against false positives. I think any spam filtering algorithm ought to have a convenient knob you can twist to decrease the false positive rate at the expense of the filtering rate. I do this by counting the occurrences of tokens in the nonspam corpus double.  
  
I don't think it's a good idea to treat spam filtering as a straight text classification problem. You can use text classification techniques, but solutions can and should reflect the fact that the text is email, and spam in particular. Email is not just text; it has structure. Spam filtering is not just classification, because false positives are so much worse than false negatives that you should treat them as a different kind of error. And the source of error is not just random variation, but a live human spammer working actively to defeat your filter.  
  
**Tokens**  
  
Another project I heard about after the Slashdot article was Bill Yerazunis' [CRM114](http://crm114.sourceforge.net) \[5\]. This is the counterexample to the design principle I just mentioned. It's a straight text classifier, but such a stunningly effective one that it manages to filter spam almost perfectly without even knowing that's what it's doing.  
  
Once I understood how CRM114 worked, it seemed inevitable that I would eventually have to move from filtering based on single words to an approach like this. But first, I thought, I'll see how far I can get with single words. And the answer is, surprisingly far.  
  
Mostly I've been working on smarter tokenization. On current spam, I've been able to achieve filtering rates that approach CRM114's. These techniques are mostly orthogonal to Bill's; an optimal solution might incorporate both.  
  
\`\`A Plan for Spam'' uses a very simple definition of a token. Letters, digits, dashes, apostrophes, and dollar signs are constituent characters, and everything else is a token separator. I also ignored case.  
  
Now I have a more complicated definition of a token:

1.  Case is preserved.  
      
    
2.  Exclamation points are constituent characters.  
      
    
3.  Periods and commas are constituents if they occur between two digits. This lets me get ip addresses and prices intact.  
      
    
4.  A price range like $20-25 yields two tokens, $20 and $25.  
      
    
5.  Tokens that occur within the To, From, Subject, and Return-Path lines, or within urls, get marked accordingly. E.g. \`\`foo'' in the Subject line becomes \`\`Subject\*foo''. (The asterisk could be any character you don't allow as a constituent.)

Such measures increase the filter's vocabulary, which makes it more discriminating. For example, in the current filter, \`\`free'' in the Subject line has a spam probability of 98%, whereas the same token in the body has a spam probability of only 65%.  
  
Here are some of the current probabilities \[6\]:  
  
Subject\*FREE      0.9999
free!!            0.9999
To\*free           0.9998
Subject\*free      0.9782
free!             0.9199
Free              0.9198
Url\*free          0.9091
FREE              0.8747
From\*free         0.7636
free              0.6546
