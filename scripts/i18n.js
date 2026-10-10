/* Bilingual presentation layer.
   English HTML remains the crawlable source. Cloudflare chooses the initial
   language from the visitor country; the switch below persists an override. */
(function () {
  'use strict';

  var COOKIE = 'site_lang_pref';
  var GEO_COOKIE = 'site_geo_lang';
  var YEAR = 31536000;
  var ZH = Object.freeze({
    'Skip to content': '\u8df3\u5230\u4e3b\u8981\u5185\u5bb9',
    'Work': '\u5de5\u4f5c',
    'Personal': '\u4e2a\u4eba',
    'Space': '\u7a7a\u95f4',
    'Site': '\u7f51\u7ad9\u5bfc\u822a',
    'Home': '\u9996\u9875',
    'home': '\u9996\u9875',
    'blog': '\u6587\u7ae0',
    'Skin': '\u76ae\u80a4',
    'Projects': '\u9879\u76ee',
    'AI Skills': 'AI \u6280\u80fd',
    'Gallery': '\u4f5c\u54c1\u96c6',
    'Writing': '\u6587\u7ae0',
    'About me': '\u5173\u4e8e\u6211',
    'Appearance': '\u5916\u89c2',
    'Automatic': '\u8ddf\u968f\u7cfb\u7edf',
    'Light': '\u6d45\u8272',
    'Dark': '\u6df1\u8272',
    'A message from Antares': 'Antares \u7684\u4e00\u6bb5\u8bdd',
    'AI moves fast, remaking itself by the day. I keep one eye on the frontier in Silicon Valley \u2014 but as an AI product manager, I\'ve learned to keep the other on the business problem in front of me. It is the compass that keeps the work grounded, honest, and on course. A note to myself, and to everyone building in this moment.': '\u5728 AI \u65f6\u4ee3\uff0c\u53d8\u5316\u6bcf\u65e5\u90fd\u5728\u52a0\u901f\u3002\u4f5c\u4e3a\u4e00\u540d AI \u4ea7\u54c1\u7ecf\u7406\uff0c\u6211\u4f1a\u5173\u6ce8\u7845\u8c37\u6700\u524d\u6cbf\u7684\u53d8\u5316\uff0c\u4f46\u4e5f\u8d8a\u6765\u8d8a\u786e\u4fe1\uff1a\u65e5\u5e38\u5de5\u4f5c\u91cc\u771f\u5b9e\u7684\u4e1a\u52a1\u95ee\u9898\u66f4\u91cd\u8981\u3002\u5b83\u50cf\u4e00\u679a\u7f57\u76d8\uff0c\u8ba9\u5de5\u4f5c\u59cb\u7ec8\u624e\u6839\u73b0\u5b9e\uff0c\u4e0d\u81f3\u4e8e\u8d70\u5f62\u3002\u5199\u7ed9\u81ea\u5df1\uff0c\u4e5f\u4e0e\u6b64\u523b\u6bcf\u4e00\u4e2a\u6b63\u5728\u6784\u5efa\u7684\u4eba\u5171\u52c9\u3002',
    'Update': '\u8fd1\u671f\u52a8\u6001',
    'The new Work version of my personal website is live \u2014 yay!': '\u65b0\u7248\u4e2a\u4eba\u7f51\u7ad9\u7684 Work Version \u5df2\u4e0a\u7ebf\uff0c\u8036\uff01',
    'AI Product Manager': 'AI \u4ea7\u54c1\u7ecf\u7406',
    'AI Product Manager. A living roadmap of what I\'ve shipped, what I\'m building, and where I\'m going.': 'AI \u4ea7\u54c1\u7ecf\u7406\u3002\u4e00\u5f20\u6301\u7eed\u66f4\u65b0\u7684\u8def\u7ebf\u56fe\uff0c\u8bb0\u5f55\u6211\u5df2\u7ecf\u4ea4\u4ed8\u7684\u3001\u6b63\u5728\u6784\u5efa\u7684\uff0c\u4ee5\u53ca\u5c06\u8981\u53bb\u7684\u65b9\u5411\u3002',
    'Personal token consumption': '\u4e2a\u4eba Token \u7528\u91cf',
    'Total tokens': 'Token \u603b\u91cf',
    'Top agent': '\u4e3b\u8981 Agent',
    'Case studies \u2014 what each project set out to do, what I did, and what came of it.': '\u9879\u76ee\u6848\u4f8b\u2014\u2014\u5b83\u4eec\u8981\u89e3\u51b3\u4ec0\u4e48\uff0c\u6211\u505a\u4e86\u4ec0\u4e48\uff0c\u4ee5\u53ca\u6700\u7ec8\u7ed3\u679c\u3002',
    'Problem': '\u95ee\u9898',
    'Needs unmet': '\u672a\u88ab\u6ee1\u8db3\u7684\u9700\u6c42',
    'Scenario': '\u573a\u666f',
    'Product': '\u4ea7\u54c1',
    'My work': '\u6211\u7684\u5de5\u4f5c',
    'Metrics': '\u6307\u6807',
    'Result': '\u7ed3\u679c',
    'Outcome': '\u7ed3\u679c',
    'Impact': '\u5f71\u54cd',
    'Breadcrumb': '\u9762\u5305\u5c51\u5bfc\u822a',
    'Other projects': '\u5176\u4ed6\u9879\u76ee',
    'previous': '\u4e0a\u4e00\u4e2a',
    'next': '\u4e0b\u4e00\u4e2a',
    'SHIPPED': '\u5df2\u4e0a\u7ebf',
    'NOW': '\u6b63\u5728\u505a',
    'NEXT': '\u4e0b\u4e00\u6b65',
    'LATER': '\u4ee5\u540e',
    'Overview': '\u6982\u89c8',
    'Process': '\u8fc7\u7a0b',
    'Discover': '\u53d1\u73b0',
    'Design & build': '\u8bbe\u8ba1\u4e0e\u6784\u5efa',
    'Ship & measure': '\u4e0a\u7ebf\u4e0e\u6d4b\u91cf',
    'Pictures': '\u56fe\u7247',
    'Links': '\u94fe\u63a5',
    'Previous': '\u4e0a\u4e00\u4e2a',
    'Next': '\u4e0b\u4e00\u4e2a',
    'Back Projects': '\u8fd4\u56de\u9879\u76ee',
    'Back to projects': '\u8fd4\u56de\u9879\u76ee',
    'Role': '\u89d2\u8272',
    'Timeline': '\u65f6\u95f4',
    'Team': '\u56e2\u961f',
    'Tools': '\u5de5\u5177',
    'Live demo': '\u5728\u7ebf\u6f14\u793a',
    'Try it live': '\u5728\u7ebf\u4f53\u9a8c',
    'A recruiting workbench for ByteDance\'s talent-acquisition team, with an agent that turns a role brief into a ranked shortlist for the hiring manager.': '\u4e3a\u5b57\u8282\u8df3\u52a8\u62db\u8058\u56e2\u961f\u6253\u9020\u7684\u5de5\u4f5c\u53f0\uff1aAgent \u5c06\u804c\u4f4d\u9700\u6c42\u8f6c\u5316\u4e3a\u6392\u5e8f\u540e\u7684\u5019\u9009\u4eba\u77ed\u540d\u5355\uff0c\u4f9b\u7528\u4eba\u7ecf\u7406\u51b3\u7b56\u3002',
    'An open-source token-analysis project inside ByteDance, built without hand-offs: I raised the problem, designed the Token Efficiency Leaderboard, tested it and shipped it myself.': '\u5b57\u8282\u8df3\u52a8\u5185\u90e8\u7684\u5f00\u6e90 Token \u5206\u6790\u9879\u76ee\u3002\u4ece\u63d0\u51fa\u95ee\u9898\u3001\u8bbe\u8ba1 Token \u6548\u7387\u699c\uff0c\u5230\u6d4b\u8bd5\u548c\u4e0a\u7ebf\uff0c\u90fd\u7531\u6211\u72ec\u7acb\u5b8c\u6210\u3002',
    'A project agent that lives in Lark group chats: it remembers what the team worked out and turns the discussion into specs, task tables and slides.': '\u4e00\u4e2a\u751f\u957f\u5728\u98de\u4e66\u7fa4\u804a\u91cc\u7684\u9879\u76ee Agent\uff1a\u8bb0\u4f4f\u56e2\u961f\u7ed3\u8bba\uff0c\u5e76\u5c06\u8ba8\u8bba\u8f6c\u5316\u4e3a\u89c4\u683c\u3001\u4efb\u52a1\u8868\u4e0e\u6f14\u793a\u6587\u7a3f\u3002',
    'A group-chat platform where a team of AI agents takes a goal, agrees on a plan and splits the work itself, with the user in control at three gates.': '\u4e00\u4e2a\u591a Agent \u7fa4\u804a\u5e73\u53f0\uff1aAgent \u56e2\u961f\u63a5\u6536\u76ee\u6807\u3001\u534f\u5546\u8ba1\u5212\u5e76\u81ea\u4e3b\u62c6\u89e3\u4efb\u52a1\uff0c\u7528\u6237\u5728\u4e09\u4e2a\u5173\u952e\u8282\u70b9\u4fdd\u6301\u63a7\u5236\u3002',
    'An online benchmark that injects dark patterns into 55 real websites, to test whether computer-use agents fall for designs made to fool people.': '\u4e00\u4e2a\u5728 55 \u4e2a\u771f\u5b9e\u7f51\u7ad9\u4e2d\u6ce8\u5165\u9ed1\u6697\u6a21\u5f0f\u7684\u5728\u7ebf\u57fa\u51c6\uff0c\u7528\u4e8e\u6d4b\u8bd5\u8ba1\u7b97\u673a\u64cd\u4f5c Agent \u662f\u5426\u4f1a\u88ab\u8bef\u5bfc\u4eba\u7684\u8bbe\u8ba1\u6240\u6b3a\u9a97\u3002',
    'Skills and plugins I built for Claude Code and other agents. Each row goes straight to its official site or GitHub repository.': '\u6211\u4e3a Claude Code \u548c\u5176\u4ed6 Agent \u6784\u5efa\u7684\u6280\u80fd\u4e0e\u63d2\u4ef6\u3002\u70b9\u51fb\u4efb\u610f\u5361\u7247\uff0c\u53ef\u76f4\u8fbe\u5b98\u7f51\u6216 GitHub \u4ed3\u5e93\u3002',
    'Skills and plugins for Claude Code and other agents, by Antares Yuan \u2014 official sites and source repositories.': 'Antares Yuan \u4e3a Claude Code \u548c\u5176\u4ed6 Agent \u6784\u5efa\u7684\u6280\u80fd\u4e0e\u63d2\u4ef6\u2014\u2014\u5305\u542b\u5b98\u7f51\u4e0e\u6e90\u7801\u4ed3\u5e93\u3002',
    'Featured': '\u7cbe\u9009',
    'Everything You Need as an AI PM': '\u6210\u4e3a AI PM \u6240\u9700\u7684\u4e00\u5207',
    'An AI PM skill kit: one orchestrator that routes by stage, six skills from research to PRD, and one shared foundation every skill reads.': '\u4e00\u5957 AI PM \u6280\u80fd\u5de5\u5177\u7bb1\uff1a\u7531\u4e00\u4e2a\u6309\u9636\u6bb5\u8c03\u5ea6\u7684\u7f16\u6392\u5668\u3001\u516d\u4e2a\u4ece\u7814\u7a76\u5230 PRD \u7684\u72ec\u7acb\u6280\u80fd\uff0c\u4ee5\u53ca\u4e00\u5957\u5171\u4eab\u57fa\u7840\u7ec4\u6210\u3002',
    'Shared memory for ChatGPT, Claude, Codex, and Claude Code': '\u4e3a ChatGPT\u3001Claude\u3001Codex \u548c Claude Code \u63d0\u4f9b\u5171\u4eab\u8bb0\u5fc6',
    'An unattended dev loop that works your issue queue': '\u81ea\u4e3b\u5904\u7406 Issue \u961f\u5217\u7684\u65e0\u4eba\u503c\u5b88\u5f00\u53d1\u5faa\u73af',
    'A human-reviewed improvement loop for other skills': '\u4e00\u5957\u7531\u4eba\u5ba1\u6838\u7684\u6280\u80fd\u8fed\u4ee3\u5faa\u73af',
    'A r\u00e9sum\u00e9 reviewer that reads like an AI PM hiring loop': '\u50cf AI PM \u62db\u8058\u6d41\u7a0b\u4e00\u6837\u5ba1\u89c6\u7b80\u5386',
    'Synthetic interviews that read like real transcripts': '\u50cf\u771f\u5b9e\u5f55\u97f3\u8f6c\u5199\u4e00\u6837\u7684\u5408\u6210\u8bbf\u8c08',
    'Resumes your Claude Code work the moment credits renew': '\u989d\u5ea6\u6062\u590d\u65f6\u81ea\u52a8\u7ee7\u7eed Claude Code \u5de5\u4f5c',
    'Visit site': '\u8bbf\u95ee\u5b98\u7f51',
    'Featured \u00b7 Claude Code skill kit': '\u7cbe\u9009 \u00b7 Claude Code \u6280\u80fd\u5957\u4ef6',
    'Claude Code skill kit': 'Claude Code \u6280\u80fd\u5957\u4ef6',
    'Filter by type': '\u6309\u7c7b\u578b\u7b5b\u9009',
    'Copy install command': '\u590d\u5236\u5b89\u88c5\u547d\u4ee4',
    'All': '\u5168\u90e8',
    'Skill kits': '\u6280\u80fd\u5957\u4ef6',
    'Agent infra': 'Agent \u57fa\u7840\u8bbe\u65bd',
    'Skills': '\u6280\u80fd',
    'Plugins': '\u63d2\u4ef6',
    'Copy': '\u590d\u5236',
    'Copied': '\u5df2\u590d\u5236',
    'No skill matches that.': '\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u6280\u80fd\u3002',
    'skills, each callable on its own': '\u4e2a\u53ef\u72ec\u7acb\u8c03\u7528\u7684\u6280\u80fd',
    'static checks passed': '\u9879\u9759\u6001\u68c0\u67e5\u901a\u8fc7',
    'current version': '\u5f53\u524d\u7248\u672c',
    'Product and visual design, 3D, physical pieces, photography and illustration. Click one for a closer look.': '\u4ea7\u54c1\u4e0e\u89c6\u89c9\u8bbe\u8ba1\u30013D\u3001\u5b9e\u4f53\u4f5c\u54c1\u3001\u6444\u5f71\u4e0e\u63d2\u753b\u3002\u70b9\u51fb\u4f5c\u54c1\u5373\u53ef\u7ec6\u770b\u3002',
    'Product design': '\u4ea7\u54c1\u8bbe\u8ba1',
    'Visual communication': '\u89c6\u89c9\u4f20\u8fbe',
    '3D art': '3D \u827a\u672f',
    'Physical product': '\u5b9e\u4f53\u4ea7\u54c1',
    'Photography': '\u6444\u5f71',
    'Illustration': '\u63d2\u753b',
    'NFT art': 'NFT \u827a\u672f',
    'AI museum tour guide': 'AI \u535a\u7269\u9986\u5bfc\u89c8',
    'Outdoor app concept': '\u6237\u5916 App \u6982\u5ff5',
    'In-car app concept': '\u8f66\u8f7d App \u6982\u5ff5',
    'Logo studies': 'Logo \u63a2\u7d22',
    'Spanish Culture Day identity': '\u897f\u73ed\u7259\u6587\u5316\u65e5\u89c6\u89c9\u8bc6\u522b',
    'Climate collage': '\u6c14\u5019\u62fc\u8d34',
    'Pocket device render': '\u53e3\u888b\u8bbe\u5907\u6e32\u67d3',
    'Glass wind chimes': '\u73bb\u7483\u98ce\u94c3',
    'Snow globe cabin': '\u96ea\u7403\u5c0f\u5c4b',
    'Wall light panel': '\u5899\u9762\u706f\u677f',
    'Mixed-media model': '\u7efc\u5408\u6750\u6599\u6a21\u578b',
    'Carved form studies': '\u96d5\u523b\u9020\u578b\u7814\u7a76',
    'Mount Rainier': '\u96f7\u5c3c\u5c14\u5c71',
    'Orion Nebula': '\u730e\u6237\u5ea7\u661f\u4e91',
    'Meteor night': '\u6d41\u661f\u4e4b\u591c',
    'Milky Way': '\u94f6\u6cb3',
    'Sunset cliff': '\u65e5\u843d\u60ac\u5d16',
    'Night street': '\u591c\u8272\u8857\u9053',
    'Desert airship': '\u6c99\u6f20\u98de\u8247',
    'Cat on the roof': '\u5c4b\u9876\u7684\u732b',
    'Monochrome figures': '\u5355\u8272\u4eba\u7269',
    'Read the process log': '\u9605\u8bfb\u8fc7\u7a0b\u8bb0\u5f55',
    'Writeups, teardowns and notes from building.': '\u6784\u5efa\u8fc7\u7a0b\u4e2d\u7684\u6587\u7ae0\u3001\u62c6\u89e3\u4e0e\u968f\u7b14\u3002',
    'Make your personal site agent-answerable': '\u8ba9\u4e2a\u4eba\u7f51\u7ad9\u80fd\u88ab Agent \u53ef\u9760\u5730\u56de\u7b54',
    'This article is available in its original English.': '\u672c\u6587\u6b63\u6587\u4fdd\u7559\u82f1\u6587\u539f\u6587\u3002',
    'I build AI products that stay grounded in real problems.': '\u6211\u505a\u624e\u6839\u4e8e\u771f\u5b9e\u95ee\u9898\u7684 AI \u4ea7\u54c1\u3002',
    'About Antares Yuan \u2014 AI product manager, human-centered designer and builder.': '\u5173\u4e8e Antares Yuan\u2014\u2014AI \u4ea7\u54c1\u7ecf\u7406\u3001\u4eba\u672c\u8bbe\u8ba1\u8005\u4e0e Builder\u3002',
    'I\u2019m Antares (Chenjie) Yuan, an AI product manager working across product strategy, human-centered design and hands-on building.': '\u6211\u662f Antares\uff08\u8881\u6668\u6770\uff09\uff0c\u4e00\u540d AI \u4ea7\u54c1\u7ecf\u7406\uff0c\u5de5\u4f5c\u6a2a\u8de8\u4ea7\u54c1\u7b56\u7565\u3001\u4eba\u672c\u8bbe\u8ba1\u4e0e\u4eb2\u624b\u6784\u5efa\u3002',
    'How I work': '\u6211\u5982\u4f55\u5de5\u4f5c',
    'What I care about': '\u6211\u5728\u610f\u7684\u4e8b',
    'AI agents that earn trust through clear product behavior.': '\u901a\u8fc7\u6e05\u6670\u4ea7\u54c1\u884c\u4e3a\u8d62\u5f97\u4fe1\u4efb\u7684 AI Agent\u3002',
    '0\u21921 systems that connect research, strategy and shipping.': '\u4e32\u8d77\u7814\u7a76\u3001\u7b56\u7565\u548c\u4ea4\u4ed8\u7684 0\u21921 \u7cfb\u7edf\u3002',
    'Human-centered interfaces for complex AI capabilities.': '\u4e3a\u590d\u6742 AI \u80fd\u529b\u8bbe\u8ba1\u4eba\u672c\u4ea4\u4e92\u3002',
    'Currently': '\u8fd1\u671f',
    'Currently open to: founder conversations in AI infra & agents, AI PM roles at top product orgs, and contractor work on 0\u21921 features. <em>Tell me what you\'re building.</em>': '\u76ee\u524d\u5f00\u653e\u4e8e\uff1a\u4e0e AI \u57fa\u7840\u8bbe\u65bd\u548c Agent \u65b9\u5411\u7684\u521b\u4e1a\u8005\u4ea4\u6d41\uff0c\u4e00\u6d41\u4ea7\u54c1\u56e2\u961f\u7684 AI PM \u804c\u4f4d\uff0c\u4ee5\u53ca 0\u21921 \u529f\u80fd\u7684\u5408\u7ea6\u5408\u4f5c\u3002\u6b22\u8fce\u544a\u8bc9\u6211\u4f60\u6b63\u5728\u505a\u4ec0\u4e48\u3002',
    'Currently open to: founder conversations in AI infra & agents, AI PM roles at top product orgs, and contractor work on 0\u21921 features.': '\u76ee\u524d\u5f00\u653e\u4e8e\uff1a\u4e0e AI \u57fa\u7840\u8bbe\u65bd\u548c Agent \u65b9\u5411\u7684\u521b\u4e1a\u8005\u4ea4\u6d41\uff0c\u4e00\u6d41\u4ea7\u54c1\u56e2\u961f\u7684 AI PM \u804c\u4f4d\uff0c\u4ee5\u53ca 0\u21921 \u529f\u80fd\u7684\u5408\u7ea6\u5408\u4f5c\u3002',
    'Tell me what you\'re building.': '\u6b22\u8fce\u544a\u8bc9\u6211\u4f60\u6b63\u5728\u505a\u4ec0\u4e48\u3002',
    'View r\u00e9sum\u00e9': '\u67e5\u770b\u7b80\u5386',
    'Elsewhere': '\u5176\u4ed6\u5e73\u53f0',
    'Personal telemetry': '\u4e2a\u4eba\u6570\u636e\u8bb0\u5f55',
    'AI usage, in full': 'AI \u4f7f\u7528\u5168\u8c8c',
    'The complete view behind the homepage snapshot \u2014 how often I build with coding agents, when the work happens, and what shape it takes.': '\u9996\u9875\u5feb\u7167\u80cc\u540e\u7684\u5b8c\u6574\u89c6\u56fe\u2014\u2014\u6211\u591a\u4e45\u4e0e\u7f16\u7a0b Agent \u6784\u5efa\u4e00\u6b21\u3001\u5de5\u4f5c\u4f55\u65f6\u53d1\u751f\uff0c\u4ee5\u53ca\u5b83\u5448\u73b0\u4ec0\u4e48\u5f62\u72b6\u3002',
    'Full AI-coding usage dashboard for Antares Yuan \u2014 tokens, cost, working rhythm and per-tool breakdowns, updated automatically.': 'Antares Yuan \u7684\u5b8c\u6574 AI \u7f16\u7a0b\u7528\u91cf\u770b\u677f\u2014\u2014Token\u3001\u6210\u672c\u3001\u5de5\u4f5c\u8282\u594f\u4e0e\u5de5\u5177\u5206\u5e03\uff0c\u81ea\u52a8\u66f4\u65b0\u3002',
    'Back home': '\u8fd4\u56de\u9996\u9875',
    'Loading\u2026': '\u52a0\u8f7d\u4e2d\u2026',
    'Daily activity': '\u6bcf\u65e5\u6d3b\u52a8',
    'Token mix': 'Token \u6784\u6210',
    'Working rhythm': '\u5de5\u4f5c\u8282\u594f',
    'Weekly trend': '\u6bcf\u5468\u8d8b\u52bf',
    'Hour of day': '\u4e00\u5929\u4e2d\u7684\u65f6\u6bb5',
    'Day of week': '\u4e00\u5468\u4e2d\u7684\u65e5\u671f',
    'Session shape': '\u4f1a\u8bdd\u5f62\u6001',
    'Tool mix': '\u5de5\u5177\u6784\u6210',
    'By tool': '\u6309\u5de5\u5177',
    'By model': '\u6309\u6a21\u578b',
    'By project': '\u6309\u9879\u76ee',
    'Owner view': '\u4e3b\u4eba\u89c6\u56fe',
    'unlock': '\u89e3\u9501',
    'clear': '\u6e05\u9664',
    'Add a device': '\u6dfb\u52a0\u8bbe\u5907',
    'Full setup notes \u2192': '\u5b8c\u6574\u8bbe\u7f6e\u8bf4\u660e \u2192',
    'Roadmap': '\u8def\u7ebf\u56fe',
    'Board': '\u770b\u677f',
    'Table': '\u8868\u683c',
    'Specs': '\u89c4\u683c',
    'A star to ship by.': '\u4ee5\u661f\u4e3a\u822a\uff0c\u5411\u4ea7\u54c1\u800c\u884c\u3002',
    'Seattle | Beijing \u00b7 currently working at ByteDance as an AI PM intern': '\u897f\u96c5\u56fe \u00b7 \u5317\u4eac \u00b7 \u76ee\u524d\u5728\u5b57\u8282\u8df3\u52a8\u62c5\u4efb AI \u4ea7\u54c1\u5b9e\u4e60\u751f',
    'Building in public': '\u516c\u5f00\u6784\u5efa\u4e2d',
    'Ex ByteDance': '\u524d\u5b57\u8282\u8df3\u52a8',
    'for agents': '\u7ed9 Agent',
    'use the CLI': '\u4f7f\u7528 CLI',
    'for HR': '\u7ed9 HR',
    '30-second snapshot': '30 \u79d2\u5feb\u7167',
    'for founders': '\u7ed9\u521b\u4e1a\u8005',
    'what I\'m building next': '\u6211\u4e0b\u4e00\u6b65\u505a\u4ec0\u4e48',
    'for collaborators': '\u7ed9\u5408\u4f5c\u4f19\u4f34',
    'let\'s talk': '\u6765\u804a\u804a',
    'Antares\'s': 'Antares \u7684',
    'Token Consumption': 'Token \u7528\u91cf',
    'Less': '\u5c11',
    'More': '\u591a',
    'tokens': 'Token',
    'sessions': '\u4f1a\u8bdd',
    'days active': '\u6d3b\u8dc3\u5929\u6570',
    'all charts \u2192': '\u5168\u90e8\u56fe\u8868 \u2192',
    'live': '\u5b9e\u65f6',
    'cards': '\u5f20\u5361\u7247',
    'Later': '\u4ee5\u540e',
    'SIDE PROJECT': '\u4e2a\u4eba\u9879\u76ee',
    'HACKATHON PROJECT': '\u9ed1\u5ba2\u677e\u9879\u76ee',
    'RESEARCH PROJECT': '\u7814\u7a76\u9879\u76ee',
    'INTERN PROJECT': '\u5b9e\u4e60\u9879\u76ee',
    'ByteDance': '\u5b57\u8282\u8df3\u52a8',
    'Internal Open Source': '\u5185\u90e8\u5f00\u6e90',
    'Token Efficiency': 'Token \u6548\u7387',
    'AI Agent': 'AI Agent',
    'Intern Project': '\u5b9e\u4e60\u9879\u76ee',
    'Staged rollout': '\u5206\u9636\u6bb5\u4e0a\u7ebf',
    'Lark Campus AI Challenge': '\u98de\u4e66\u6821\u56ed AI \u6311\u6218\u8d5b',
    'Memory & Retrieval': '\u8bb0\u5fc6\u4e0e\u68c0\u7d22',
    'ByteDance AI Full-Stack Challenge': '\u5b57\u8282\u8df3\u52a8 AI \u5168\u6808\u6311\u6218\u8d5b',
    'Agent Orchestration': 'Agent \u7f16\u6392',
    'Top 3': '\u524d\u4e09\u540d',
    'Research': '\u7814\u7a76',
    'Computer-Use Agents': '\u8ba1\u7b97\u673a\u64cd\u4f5c Agent',
    'Benchmark': '\u57fa\u51c6\u8bc4\u6d4b',
    'Company': '\u516c\u53f8',
    'Project': '\u9879\u76ee',
    'My part': '\u6211\u8d1f\u8d23\u7684\u90e8\u5206',
    'Reach': '\u8986\u76d6',
    'Event': '\u8d5b\u4e8b',
    'Users': '\u7528\u6237',
    'Model': '\u6a21\u578b',
    'Models': '\u6a21\u578b',
    'Venue': '\u53d1\u8868\u4f1a\u8bae',
    'Authorship': '\u4f5c\u8005\u8d21\u732e',
    'Institution': '\u673a\u6784',
    'Career Pivot': '\u804c\u4e1a\u8f6c\u578b',
    'Job Application': '\u6c42\u804c',
    'Chrome Extension': 'Chrome \u6269\u5c55',
    'Open Source': '\u5f00\u6e90',
    'Observability': '\u53ef\u89c2\u6d4b\u6027',
    'The collaborative AI Agent rooted  in the Lark ecosystem.': '\u4e00\u4e2a\u624e\u6839\u4e8e\u98de\u4e66\u751f\u6001\u7684\u534f\u4f5c\u578b AI Agent\u3002',
    'Agentic RAG Reference Benchmark for Trustworthiness Evaluation': '\u7528\u4e8e\u4fe1\u4efb\u6027\u8bc4\u4f30\u7684 Agentic RAG \u5f15\u7528\u57fa\u51c6\u3002',
    'Gmail++ is a AI-powered email ranking platform that gives you a read-only reply queue on top of Gmail, with visible reasoning and reversible account-scoped preferences.': 'Gmail++ \u662f\u4e00\u4e2a AI \u90ae\u4ef6\u6392\u5e8f\u5e73\u53f0\uff1a\u5728 Gmail \u4e0a\u63d0\u4f9b\u53ea\u8bfb\u56de\u590d\u961f\u5217\u3001\u53ef\u89c1\u7684\u63a8\u7406\u4f9d\u636e\uff0c\u4ee5\u53ca\u53ef\u64a4\u9500\u7684\u8d26\u6237\u7ea7\u504f\u597d\u3002',
    'WorthFly currently focuses on search, decision support, alert drafts, and external purchase handoff. Final fare, inventory, and ticketing still belong to the real booking channel.': 'WorthFly \u76ee\u524d\u805a\u7126\u641c\u7d22\u3001\u51b3\u7b56\u652f\u6301\u3001\u63d0\u9192\u8349\u7a3f\u4e0e\u5916\u90e8\u8d2d\u4e70\u8df3\u8f6c\u3002\u6700\u7ec8\u4ef7\u683c\u3001\u5e93\u5b58\u548c\u51fa\u7968\u4ecd\u7531\u771f\u5b9e\u9884\u8ba2\u6e20\u9053\u5b8c\u6210\u3002',
    'Online benchmark for evaluating the susceptibility of CUAs to UI dark patterns.': '\u8bc4\u4f30\u8ba1\u7b97\u673a\u64cd\u4f5c Agent \u5bf9 UI \u9ed1\u6697\u6a21\u5f0f\u6613\u611f\u6027\u7684\u5728\u7ebf\u57fa\u51c6\u3002',
    'ApplyMint is a AI-powered chrome extension that compiles the resume into JSON, import it once for visual editing, and automatically fill it in one click on the job application form': 'ApplyMint \u662f\u4e00\u4e2a AI \u9a71\u52a8\u7684 Chrome \u6269\u5c55\uff1a\u5c06\u7b80\u5386\u7f16\u8bd1\u4e3a JSON\uff0c\u4e00\u6b21\u5bfc\u5165\u540e\u53ef\u89c6\u5316\u7f16\u8f91\uff0c\u5e76\u80fd\u4e00\u952e\u586b\u5199\u7533\u8bf7\u8868\u5355\u3002',
    'Ongoing project about building a system about using LLM to auto fix the dark patterns on the websites.': '\u4e00\u4e2a\u8fdb\u884c\u4e2d\u7684\u9879\u76ee\uff1a\u6784\u5efa\u4f7f\u7528 LLM \u81ea\u52a8\u4fee\u590d\u7f51\u7ad9\u9ed1\u6697\u6a21\u5f0f\u7684\u7cfb\u7edf\u3002',
    'Designing Healthier Pre-Sleep Phone Use Experience for Teens & Early Adults': '\u4e3a\u9752\u5c11\u5e74\u4e0e\u5e74\u8f7b\u6210\u4eba\u8bbe\u8ba1\u66f4\u5065\u5eb7\u7684\u7761\u524d\u624b\u673a\u4f7f\u7528\u4f53\u9a8c\u3002',
    'Stop briefing engineers \u2014 become one. Use solo builder loops to solve real business problems end-to-end, not just spec them.': '\u4e0d\u518d\u53ea\u7ed9\u5de5\u7a0b\u5e08\u5199\u9700\u6c42\u2014\u2014\u6210\u4e3a\u5de5\u7a0b\u5e08\u3002\u7528\u72ec\u7acb Builder \u5faa\u73af\u7aef\u5230\u7aef\u89e3\u51b3\u771f\u5b9e\u4e1a\u52a1\u95ee\u9898\uff0c\u800c\u4e0d\u53ea\u662f\u5199\u89c4\u683c\u3002',
    'Most AI products inherit the model\'s flat default aesthetic. Explore distillation + skill composition to ship AI that\'s well-crafted, not just functional.': '\u5927\u591a\u6570 AI \u4ea7\u54c1\u6cbf\u7528\u6a21\u578b\u6241\u5e73\u7684\u9ed8\u8ba4\u5ba1\u7f8e\u3002\u63a2\u7d22\u84b8\u998f\u4e0e\u6280\u80fd\u7ec4\u5408\uff0c\u505a\u51fa\u7cbe\u5fc3\u6253\u78e8\u800c\u4e0d\u53ea\u662f\u80fd\u7528\u7684 AI\u3002',
    'Build operations + data analytics fluency so I own the full product lifecycle \u2014 not just the design-and-ship slice.': '\u8865\u9f50\u8fd0\u8425\u4e0e\u6570\u636e\u5206\u6790\u80fd\u529b\uff0c\u627f\u62c5\u5b8c\u6574\u4ea7\u54c1\u751f\u547d\u5468\u671f\uff0c\u800c\u4e0d\u53ea\u662f\u8bbe\u8ba1\u548c\u4ea4\u4ed8\u8fd9\u4e00\u6bb5\u3002',
    'Token-consumption analytics platform. Led the Token Efficiency Leaderboard and the efficiency analysis module, now covering thousands of internal users.': 'Token \u6d88\u8017\u5206\u6790\u5e73\u53f0\u3002\u6211\u4e3b\u5bfc Token \u6548\u7387\u699c\u4e0e\u6548\u7387\u5206\u6790\u6a21\u5757\uff0c\u76ee\u524d\u5df2\u8986\u76d6\u6570\u5343\u540d\u5185\u90e8\u7528\u6237\u3002',
    'For everyone': '\u6240\u6709\u4eba',
    'For HR': '\u7ed9 HR',
    'For founders': '\u7ed9\u521b\u4e1a\u8005',
    'For collaborators': '\u7ed9\u5408\u4f5c\u4f19\u4f34',
    'Shipped': '\u5df2\u4e0a\u7ebf',
    'Now': '\u6b63\u5728\u505a',
    'Ask anything': '\u95ee\u6211\u4efb\u4f55\u4e8b',
    'Ask Antares anything': '\u5411 Antares \u63d0\u95ee',
    'Ask Antares': '\u95ee Antares',
    'Ask a follow-up\u2026': '\u7ee7\u7eed\u8ffd\u95ee\u2026',
    'Ask a follow-up': '\u7ee7\u7eed\u8ffd\u95ee',
    'Ask a question': '\u63d0\u4e00\u4e2a\u95ee\u9898',
    'Send': '\u53d1\u9001',
    'Answers from this site\'s content \u2014 they can be wrong.': '\u56de\u7b54\u6765\u81ea\u672c\u7ad9\u5185\u5bb9\uff0c\u4f46\u4ecd\u53ef\u80fd\u51fa\u9519\u3002',
    'AI answers from this site\'s content \u2014 it can be wrong.': 'AI \u56de\u7b54\u6765\u81ea\u672c\u7ad9\u5185\u5bb9\uff0c\u4f46\u4ecd\u53ef\u80fd\u51fa\u9519\u3002',
    'New conversation': '\u65b0\u5bf9\u8bdd',
    'Close': '\u5173\u95ed',
    'Edit': '\u7f16\u8f91',
    'Source': '\u6e90\u7801',
    'Search skills': '\u641c\u7d22\u6280\u80fd',
    'Search': '\u641c\u7d22'
  });

  var TITLES = {
    '/': 'Antares Yuan',
    '/projects/': '\u9879\u76ee \u00b7 Antares Yuan',
    '/skills/': 'AI \u6280\u80fd \u00b7 Antares Yuan',
    '/gallery/': '\u4f5c\u54c1\u96c6 \u00b7 Antares Yuan',
    '/blog/': '\u6587\u7ae0 \u00b7 Antares Yuan',
    '/about/': '\u5173\u4e8e\u6211 \u00b7 Antares Yuan',
    '/usage/': 'AI \u4f7f\u7528 \u00b7 Antares Yuan',
    '/personal/': 'Antares Yuan \u00b7 \u4e2a\u4eba'
  };

  function readCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=(en|zh)(?:;|$)'));
    return match ? match[1] : '';
  }

  function writeCookie(value) {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = COOKIE + '=' + value + '; Path=/; Max-Age=' + YEAR + '; SameSite=Lax' + secure;
  }

  var queryLanguage = new URLSearchParams(location.search).get('lang');
  if (queryLanguage === 'en' || queryLanguage === 'zh') writeCookie(queryLanguage);
  var language = queryLanguage === 'en' || queryLanguage === 'zh'
    ? queryLanguage
    : (readCookie(COOKIE) || readCookie(GEO_COOKIE) || (/^zh(?:-|$)/i.test(navigator.language || '') ? 'zh' : 'en'));

  document.documentElement.lang = language === 'zh' ? 'zh-Hans' : 'en';
  document.documentElement.dataset.language = language;

  if (queryLanguage === 'en' || queryLanguage === 'zh') {
    var cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('lang');
    history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
  }

  function translateDate(text) {
    if (!/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/.test(text)) return '';
    var date = new Date(text + ' 00:00:00 UTC');
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
    }).format(date);
  }

  function translated(text) {
    if (ZH[text]) return ZH[text];
    var date = translateDate(text);
    if (date) return date;
    var match = text.match(/^(\d+) min read$/);
    if (match) return match[1] + ' \u5206\u949f\u9605\u8bfb';
    match = text.match(/^since\s+(.+)$/i);
    if (match) {
      var monthYear = match[1].match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/);
      if (monthYear) {
        var month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(monthYear[1]) + 1;
        return '\u81ea ' + monthYear[2] + ' \u5e74 ' + month + ' \u6708\u8d77';
      }
      return '\u81ea ' + match[1] + ' \u8d77';
    }
    match = text.match(/^updated\s+(.+)$/i);
    if (match) return '\u66f4\u65b0\u4e8e ' + match[1];
    match = text.match(/^(\d+)% of all tokens$/i);
    if (match) return '\u5360\u5168\u90e8 Token \u7684 ' + match[1] + '%';
    match = text.match(/^(\d+) shipped$/i);
    if (match) return '\u5df2\u4e0a\u7ebf ' + match[1] + ' \u4e2a';
    match = text.match(/^(\d+) cards$/i);
    if (match) return match[1] + ' \u5f20\u5361\u7247';
    return '';
  }

  function isExcluded(node) {
    var parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !parent || !!parent.closest('script, style, code, pre, textarea, svg, [data-no-translate]');
  }

  function translateText(node) {
    if (language !== 'zh' || node.nodeType !== Node.TEXT_NODE || isExcluded(node)) return;
    var raw = node.nodeValue;
    var clean = raw.trim();
    if (!clean) return;
    var next = translated(clean);
    if (next) node.nodeValue = raw.replace(clean, next);
  }

  function translateElement(element) {
    if (language !== 'zh' || element.nodeType !== Node.ELEMENT_NODE || isExcluded(element)) return;
    ['aria-label', 'title', 'placeholder', 'data-label'].forEach(function (name) {
      var value = element.getAttribute(name);
      if (!value) return;
      var next = translated(value);
      if (next) element.setAttribute(name, next);
    });
  }

  function translateTree(root) {
    if (language !== 'zh') return;
    if (root.nodeType === Node.TEXT_NODE) return translateText(root);
    if (root.nodeType !== Node.ELEMENT_NODE || isExcluded(root)) return;
    translateElement(root);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateText(node);
      else translateElement(node);
    }
  }

  function addLanguageSwitch() {
    if (document.querySelector('[data-language-toggle]')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'language-switch';
    button.dataset.languageToggle = '';
    button.dataset.noTranslate = '';
    button.textContent = language === 'zh' ? 'EN' : '\u4e2d\u6587';
    button.setAttribute('aria-label', language === 'zh' ? '\u5207\u6362\u5230\u82f1\u6587' : 'Switch to Chinese');
    button.title = button.getAttribute('aria-label');
    button.addEventListener('click', function () {
      writeCookie(language === 'zh' ? 'en' : 'zh');
      location.reload();
    });

    var topbar = document.querySelector('.topbar');
    var theme = document.querySelector('.theme-switch');
    if (topbar && theme) {
      var actions = document.createElement('div');
      actions.className = 'topbar-actions';
      topbar.insertBefore(actions, theme);
      actions.appendChild(button);
      actions.appendChild(theme);
      return;
    }
    var personal = document.querySelector('.topnav-end');
    if (personal) personal.insertBefore(button, personal.firstChild);
  }

  function addArticleNote() {
    if (language !== 'zh' || !/^\/blog\/[^/]+\/?$/.test(location.pathname)) return;
    var article = document.querySelector('.post-body') || document.querySelector('.prose') || document.querySelector('article');
    if (!article || document.querySelector('.article-language-note')) return;
    var note = document.createElement('p');
    note.className = 'article-language-note';
    note.textContent = ZH['This article is available in its original English.'];
    note.dataset.noTranslate = '';
    article.insertBefore(note, article.firstChild);
  }

  function updateMetadata() {
    if (language !== 'zh') return;
    var path = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
    if (TITLES[path]) document.title = TITLES[path];
    var description = document.querySelector('meta[name="description"]');
    if (description) {
      var next = translated(description.content);
      if (next) description.content = next;
    }
  }

  function boot() {
    addLanguageSwitch();
    translateTree(document.body);
    addArticleNote();
    updateMetadata();
    if (language !== 'zh') return;
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(translateTree);
        if (mutation.type === 'characterData') translateText(mutation.target);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
