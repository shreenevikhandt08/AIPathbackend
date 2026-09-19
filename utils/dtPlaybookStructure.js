const DT_PLAYBOOK = [
  {
    week: 1,
    stage: "Empathize & Define",
    goal: "Deeply understand the problem before designing anything. No solutioning yet.",
    steps: [
      {
        day: 1,
        step: "Problem Identification",
        page: 8,
        whatToLearn:
          "How to break down a given problem statement into: who has this problem, when/where it occurs, why existing solutions fail.",
        realProjectTask:
          "Take your assigned Problem Statement. Write a 1-paragraph restatement in your own words. List 3 assumptions you're making and mark each as 'known fact' or 'guess to validate'.",
        dsaConcept: "NA",
        discussionPrompt:
          "Why does this problem exist today? What is the current workaround people use, and why is it inadequate?",
      },
      {
        day: 2,
        step: "Similar Products",
        page: 10,
        whatToLearn:
          "Competitive analysis: how to evaluate 2-3 existing products solving a similar problem — not to copy, but to find gaps.",
        realProjectTask:
          "Find 2-3 real existing apps/products addressing a similar problem. For each: what do they do well, what do they miss for YOUR specific user group.",
        dsaConcept: "NA",
        discussionPrompt:
          "If these products already exist, why is your problem statement still worth solving? What's the gap?",
      },
      {
        day: 3,
        step: "My Ideas",
        page: 12,
        whatToLearn:
          "Divergent thinking before convergent thinking — generate many raw ideas without judging them yet.",
        realProjectTask:
          "Brainstorm at least 8 rough solution ideas (one line each) for your problem. Do not filter for feasibility yet — quantity first.",
        dsaConcept: "NA",
        discussionPrompt:
          "Which 2 of your ideas feel obvious/expected? Which 1 feels risky or unusual? Why might the risky one matter more?",
      },
      {
        day: 4,
        step: "Audience",
        page: 14,
        whatToLearn:
          "Defining a specific target user (not 'everyone') — persona thinking: demographics, behavior, pain points.",
        realProjectTask:
          "Write a 1-page user persona for your primary target user: name, context, daily frustration related to your problem, what they currently do instead.",
        dsaConcept: "NA",
        discussionPrompt:
          "If you had to pick ONE user type to build for first and ignore all others, who would it be and why?",
      },
      {
        day: 5,
        step: "Focus",
        page: 16,
        whatToLearn:
          "Narrowing scope — separating 'must solve now' from 'nice to have later' using a focus statement.",
        realProjectTask:
          "Write a single-sentence focus statement: '[User] needs a way to [need] because [insight].' This becomes your north star for the whole project.",
        dsaConcept: "NA",
        discussionPrompt:
          "Does your focus statement survive the question 'so what?' three times in a row?",
      },
      {
        day: 6,
        step: "Tech Stack Suggestions",
        page: 17,
        whatToLearn:
          "Exploring practical stack options for THIS problem — language, UI approach, storage — as SUGGESTIONS only (not a final lock).",
        realProjectTask:
          "Based on your problem + focus statement, write 2–3 possible stacks (language + UI + storage). Mark which one looks best for beginners on THIS project and why. Save as notes/tech-stack-ideas.md. Do NOT treat this as final — you will confirm the stack on the first coding day.",
        dsaConcept: "NA",
        discussionPrompt:
          "Which option can your team actually finish in 2 weeks — and what would you change if coding starts next week?",
      },
      {
        day: 7,
        step: "Empathy Map",
        page: 18,
        whatToLearn:
          "Structured empathy mapping: Says / Thinks / Does / Feels for your target user.",
        realProjectTask:
          "Build a 4-quadrant empathy map (Says/Thinks/Does/Feels) for your persona based on the focus statement from Day 5.",
        dsaConcept: "NA",
        discussionPrompt:
          "Where does a contradiction show up between what your user SAYS and what they actually DO?",
      },
      {
        day: 8,
        step: "Process Flow",
        page: 20,
        whatToLearn:
          "Mapping the current (as-is) process the user follows today, step by step, before proposing a new one.",
        realProjectTask:
          "Draw the CURRENT process flow (5-8 steps) your user follows today without your solution. Mark the exact step where it breaks down.",
        dsaConcept: "NA",
        discussionPrompt:
          "At which single step does the user lose the most time/trust/money? That's your leverage point.",
      },
      {
        day: 9,
        step: "Pitch Among Peers",
        page: 22,
        whatToLearn:
          "Articulating problem understanding out loud and defending it under questioning — a rehearsal for stakeholder pitches.",
        realProjectTask:
          "Prepare a 3-minute verbal pitch covering: problem, persona, focus statement, tech-stack SUGGESTIONS (not final lock), process breakdown point. Present to a peer and log 2 questions they asked that you couldn't fully answer.",
        dsaConcept: "NA",
        discussionPrompt:
          "What question from your peer exposed a gap in your problem understanding?",
      },
    ],
  },
  {
    week: 2,
    stage: "Plan",
    goal: "Translate the understood problem into concrete app behavior and features.",
    steps: [
      {
        day: 1,
        step: "User Actions",
        page: 24,
        whatToLearn: "Mapping user intent to discrete actions the app must support.",
        realProjectTask:
          "List every action your primary user needs to perform to go from problem to resolution, in order.",
        dsaConcept:
          "Arrays / Sequencing — model the action list as an ordered array; this is your first structured data.",
      },
      {
        day: 2,
        step: "App State",
        page: 26,
        whatToLearn: "What data the app must track between actions (state, not just UI).",
        realProjectTask:
          "For each user action from Day 1, define what state changes (e.g., 'status: pending → confirmed').",
        dsaConcept: "State machines / enums — represent valid state transitions explicitly.",
      },
      {
        day: 3,
        step: "Features",
        page: 28,
        whatToLearn: "Grouping actions + state into named, buildable features (not vague ones).",
        realProjectTask:
          "Cluster your user actions into 4-6 named features. Mark each MVP (must-have) or Later.",
        dsaConcept:
          "Hashing/Grouping — use a hash map to group actions by feature key; mirrors what you're doing by hand.",
      },
      {
        day: 4,
        step: "Inclusion",
        page: 30,
        whatToLearn: "Accessibility and edge-case users — designing for people you didn't first imagine.",
        realProjectTask:
          "Identify 2 user edge cases (e.g., low connectivity, first-time user, accessibility need) and how each MVP feature must adapt.",
        dsaConcept: "Edge-case/boundary condition testing — same discipline as writing test cases for edge inputs in DSA.",
      },
      {
        day: 5,
        step: "UI/UX",
        page: 32,
        whatToLearn: "Translating features into screen-level flows before visual design.",
        realProjectTask:
          "Sketch a rough screen flow (boxes and arrows, no styling) covering your MVP features end to end.",
        dsaConcept: "Graph traversal (conceptual) — a screen flow is a directed graph; think in nodes/edges.",
      },
    ],
  },
  {
    week: 3,
    stage: "Prototype",
    goal: "Turn the plan into a clickable, testable prototype.",
    steps: [
      {
        day: 1,
        step: "Sketch Screens",
        page: 34,
        whatToLearn: "Low-fidelity wireframing fundamentals.",
        realProjectTask: "Hand-sketch or wireframe every screen from your Week 2 flow.",
        dsaConcept: "NA",
      },
      {
        day: 2,
        step: "Storyboard",
        page: 36,
        whatToLearn: "Sequencing screens into a user journey narrative.",
        realProjectTask: "Arrange your sketches into a storyboard showing the full journey for your primary persona.",
        dsaConcept: "Linked list (conceptual) — each storyboard frame points to the next; think in sequential pointers.",
      },
      {
        day: 3,
        step: "Refine Behaviour",
        page: 38,
        whatToLearn: "Defining interaction details: what happens on tap, error, empty state.",
        realProjectTask: "For your 3 core screens, define: happy path, error state, empty state.",
        dsaConcept: "Conditional logic / decision trees — map each behavior branch explicitly.",
      },
      {
        day: 4,
        step: "Design Style",
        page: 40,
        whatToLearn: "Establishing a consistent visual system (color, type, spacing) before high-fidelity work.",
        realProjectTask: "Define a mini style guide: 3 colors, 2 fonts, spacing scale. Apply to one screen as proof.",
        dsaConcept: "NA",
      },
      {
        day: 5,
        step: "Build in Figma",
        page: 42,
        whatToLearn: "Producing a clickable high-fidelity prototype.",
        realProjectTask: "Build 3-5 key screens in Figma with clickable transitions between them.",
        dsaConcept: "NA",
      },
      {
        day: 6,
        step: "MVC",
        page: 44,
        whatToLearn: "Mapping your prototype to Model-View-Controller architecture before coding.",
        realProjectTask:
          "For your MVP features, define: Models (data), Views (screens from Figma), Controllers (actions connecting them).",
        dsaConcept:
          "Recursion/Trees (conceptual) — Model relationships often form a tree/hierarchy (e.g., Order → Items → Item details).",
      },
    ],
  },
  {
    week: 4,
    stage: "Evaluate",
    goal: "Test the prototype with real users and iterate based on evidence, not assumption.",
    steps: [
      {
        day: 1,
        step: "App Pitch",
        page: 46,
        whatToLearn: "Pitching the prototype (not just the problem) for feedback.",
        realProjectTask: "Prepare a demo script walking through your Figma prototype end to end.",
        dsaConcept: "NA",
      },
      {
        day: 2,
        step: "Prepare Test",
        page: 48,
        whatToLearn: "Designing a usability test plan: tasks, success criteria, what to observe.",
        realProjectTask: "Write 3 tasks a test user will attempt in your prototype, with a clear success/fail criteria for each.",
        dsaConcept: "NA",
      },
      {
        day: 3,
        step: "Observation",
        page: 50,
        whatToLearn: "Running a usability test and recording behavior objectively (not opinions).",
        realProjectTask: "Run your test plan with 1-2 real users. Log exactly where they hesitated, misclicked, or got stuck.",
        dsaConcept: "NA",
      },
      {
        day: 4,
        step: "Interview",
        page: 52,
        whatToLearn: "Post-test interviewing to get the 'why' behind observed behavior.",
        realProjectTask: "Interview your test users with 3-5 open-ended questions about what confused or delighted them.",
        dsaConcept: "NA",
      },
      {
        day: 5,
        step: "Reiterate",
        page: 54,
        whatToLearn: "Converting test findings into concrete prototype changes.",
        realProjectTask: "List 3 specific changes to make based on Day 3-4 findings, and update your Figma prototype for at least 1.",
        dsaConcept: "NA",
      },
    ],
  },
  {
    week: 5,
    stage: "Pitch & BMC",
    goal: "Package the validated solution into a business-ready pitch.",
    steps: [
      {
        day: 1,
        step: "BMC Canvas",
        page: 56,
        whatToLearn: "Business Model Canvas fundamentals: value proposition, channels, revenue streams.",
        realProjectTask: "Fill a 9-block BMC for your solution based on everything learned in Weeks 1-4.",
        dsaConcept: "NA",
      },
      {
        day: 2,
        step: "Customer Sales Pitch",
        page: 58,
        whatToLearn: "Selling the solution to a customer, not just presenting a project.",
        realProjectTask: "Write and rehearse a 2-minute sales pitch framed around the user's problem and your validated fix.",
        dsaConcept: "NA",
      },
      {
        day: 3,
        step: "Final Pitch Deck",
        page: 60,
        whatToLearn: "Assembling problem, journey, prototype, evidence, and business model into one deck.",
        realProjectTask: "Build a final pitch deck: Problem → Empathy insight → Prototype → Test evidence → BMC → Ask.",
        dsaConcept: "NA",
      },
    ],
  },
];

/**
 * Canonical "Define the opportunity, problem, or challenge" questions from the
 * DT Playbook (Empathize & Define, Purpose topic). Verbatim from the worksheet.
 */
const DT_PROBLEM_BREAKDOWN = {
  brainstormList: "Brainstorm a list of opportunities, problems, or challenges you care about.",
  oneSentence: "Choose the most interesting idea from your list and try to explain it in just one sentence.",
  whatDoYouKnow: "What do you know about the opportunity, problem, or challenge? What do you need to learn more about?",
  whoCares: "Who cares about or is affected by this opportunity, problem, or challenge?",
  whatQuestions: "What questions do you need to find answers to?",
};

/**
 * Exact worksheet questions per DT Playbook step (same wording students fill in the book).
 * Schedule must ask THESE — not paraphrases.
 */
const DT_PLAYBOOK_QUESTIONS = {
  "Problem Identification": [
    DT_PROBLEM_BREAKDOWN.brainstormList,
    DT_PROBLEM_BREAKDOWN.oneSentence,
    DT_PROBLEM_BREAKDOWN.whatDoYouKnow,
    DT_PROBLEM_BREAKDOWN.whoCares,
    DT_PROBLEM_BREAKDOWN.whatQuestions,
  ],
  "Similar Products": [
    "Think about the products/ apps that you use. Identify each product's/ app's purpose and why you use it.",
    "Which do you use most, and which did you stop using after just a few times? Why did you buy/ download them in the first place?",
    "Brainstorm a list of your favorite products/ apps, and identify their purposes and the features that make them good.",
    "Product/ App purpose:",
    "I like this product/ app because .",
    "Add example of your product's/ app's top competitor here. Is it easy to use? Why or why not?",
    "Can you list down the challenges while using the products/ app?",
    "How could it be designed better?",
  ],
  "My Ideas": [
    "Brainstorm and create a list of products/ apps you'd like to build and how they'd help address the opportunity, problem, or challenge you identified.",
    "My product/ app idea",
    "How my product/ app will help",
    "Add your ideas.",
  ],
  Audience: [
    "It's important to design with a target audience in mind. Who do they want to use their product / app?",
    "What have you learned about the audience those products / apps are meant for?",
    "Did the developers do a good job communicating that?",
    "Judging from the screenshots or preview video, do you think the products / apps are appropriate for their intended audiences?",
    "It's important to design with a target audience. Who do you want to use your product / app?",
    "What does this person do? How old is the person? Why is the person using the product/ app? Does the person prefer pictures or words? How often does the person use their product/app?",
  ],
  Focus: [
    "What will your product/ app do? My product/ app will . . .",
    "Why does this need exist? because . . .",
    "My product/ app will help [audience] with [opportunity, problem, challenge] by [what the app will do].",
    "Get more specific about your product/ app idea. Write down any goals for your product/ app and describe what someone would do with it.",
  ],
  "Tech Stack Suggestions": [
    "Based on your problem + focus statement, write 2–3 possible stacks (language + UI + storage).",
    "Mark which one looks best for beginners on THIS project and why.",
    "Which option can your team actually finish in 2 weeks — and what would you change if coding starts next week?",
  ],
  "Empathy Map": [
    "Who are we empathizing with? Who is the person we want to understand? What is the situation they are in? What is their role in the situation?",
    "What do they need to do? What job do they want or need to get done? What decisions do they need to make? How will we know they were successful?",
    "What do they see? What do they see in the market place? What do they see in their immediate environment? What do they see others saying and doing? What are they watching and reading?",
    "What do they hear? What are they hearing others say? What are they hearing from friends? What are they hearing from colleagues?",
    "What do they say? What have we heard them say? What can we imagine them saying?",
    "What do they do? What are they doing today? What behavior have we observed? What can we imagine them doing?",
    "Pains: What are their fears, frustrations and anxieties?",
    "Gains: What are their wants, needs, hope and dreams?",
    "What other thoughts and behaviour might motivate their behaviour?",
  ],
  "Process Flow": [
    "After finalizing the problem statement, the process flow serves as a critical blueprint for the development of applications, providing a clear and structured sequence of steps that ensures all aspects of the solution are systematically addressed.",
    "If required, the process flow can mention detailed steps to facilitate a thorough understanding, each stage in detail, key checkpoints and actions needed for successful completion, any contingencies or alternative steps, and additional details to support efficient implementation.",
  ],
  "Pitch Among Peers": [
    "Feedback and Refinement",
    "Collaboration and Support",
    "Validate the concept",
    "Help in Resource Identification",
    "Confidence Building",
    "Networking",
  ],
  "User Actions": [
    "Based on your product/ app idea, list the different things a user will want to do in your product/ app. Add one user action in each box.",
    "A user will need to",
  ],
  "App State": [
    "From the list you created on the User actions slide, identify ways users will interact with your product/ app.",
    "User input",
    "Changes to the app state",
  ],
  Features: [
    "Many features are available to help you design great apps. Look through the partial list below and add checkmarks for the ones you might need for your app. Are there any others not listed that you might need?",
    "Keyboard, Camera, Microphone, Touchscreen, Gyroscope, Accelerometer, GPS, Bluetooth, Map, Augmented reality, Speakers, Haptics, Machine learning, Other.",
    "Identify where each of the user action features would be utilized in your app/product.",
  ],
  Inclusion: [
    "Try to think about your product/ app through different perspectives. How will your product/ app support a wide variety of users?",
    "Consider how to make your product/ app approachable and welcoming to all. What will you need to do so that users can fully access the accessibility features in your product/ app?",
    "Cognitive Support, Accessibility Descriptions, Accessible Content, Alternate Input.",
  ],
  "UI/UX": [
    "Go back to your list of similar products/ apps and choose one to review. Think about the features that make it easy to use.",
    "Now consider the rest of the list of your similar product/ apps. Rank them in terms of their UI design. Which products/ apps are easy to use and seem to just work? Write down the reasons that some products/ apps are easier to use than others.",
    "Did you know what to do immediately? How many steps did it take to start using the product effectively? How many taps did it take to get going on the app?",
  ],
  "Sketch Screens": [
    "Choose one user activity to prototype from the list you created on the User Actions slide. Describe the user activity in more depth.",
    "Use pen and paper or a drawing app to sketch between one and three screens that show the user activity you chose.",
  ],
  Storyboard: [
    "Copy and paste your product/ app sketches from the Sketch Screens slide, then draw arrows to show the interactions between product components/ interactions between screens.",
    "Refer to your ideas on the Input and product/ App State slide to remind yourself how your product's/ app's look or function will change with user actions.",
  ],
  "Refine Behaviour": [
    "There are two main categories of how the app state can change with user input: Onscreen (changes to the interface, such as a new screen, button, or text that appears) and Offscreen (changes to information behind the scenes, such as a calculation, saved user input, or a photo filter).",
    "Take a screenshot of the outline for your app and add it to this slide. Drag a box that corresponds to the type of change in the app state down to each user input in your storyboard. Draw lines to connect each user input to the box and write a short description of the change in the app state.",
  ],
  "Design Style": [
    "Give your product/ app some style and personality. Remember to keep your product's/ app's purpose and audience in mind, and think about how your design choices can make your product/ app inclusive and accessible to your users.",
    "Choose a color scheme.",
    "Sketch details of user interface (UI) elements such as buttons, navigation tools, or other visuals. If your product/ app uses color to show information, sketch features/ icons to support colorblind users, too.",
    "For each visual UI element, practice writing alternative descriptions for a person who's blind by selecting the image, clicking or tapping the Image tab in the Format sidebar, and adding text to the Description field.",
    "What fonts will your app use?",
    "Add sound files or describe the sounds your app will use to notify users of something, immerse them in a game atmosphere, or enhance the app's mood.",
  ],
  "Build in Figma": [
    "Create a new project. Download the template. Use the ideas from your sketches and design elements to create screens in your UI/UX Tool prototype. Build each screen on a different slide.",
    "Make interactive links to mimic product/ app behavior — use your notes from the Refine App Behavior slide to add links between the slides so that you can navigate between screens and trigger responses as you would with code.",
  ],
  MVC: [
    "Use pen and paper or a drawing app to sketch a few features/ icons for your product/ app. Add them here and put your top choice first.",
    "Come up with a few different names for your product/ app. Put your top choice first.",
    "Models: What data do you need to build your features? Where does the data come from? Does the user supply it or does it come from a web service? Do you need to store the data on the device for offline access?",
    "Views: Are there particular views you want to show on multiple screens? Did you include any customised gestures?",
    "Controllers: How many view controllers does your app need? What controllers will help manage the data? Does your app have customised transitions that need a controller?",
    "Which views are most important and need to work first? Which views might you want to save to build at the end?",
  ],
  "App Pitch": [
    "One way to test your product/ app idea is to develop a pitch and share it with others. Make a three-minute presentation or video of your pitch. A good pitch will tell a strong and clear story that makes people want your product/ app.",
    "Why: The problem your product/ app is trying to solve.",
    "Who: A description of who your product/ app is for.",
    "What: An overview of the product/ app or a demonstration of the prototype.",
    "How: Details about user experience and user interface, including the design, features and improvements you've made.",
    "What feedback did you receive about your product/ app idea?",
  ],
  "Prepare Test": [
    "Describe the activity you want your tester to accomplish with your prototype. Think about what you'd like feedback on and tested.",
    "Write a script that you'll read to your testers to introduce the task and product/ app. Try using a part of your product/ app pitch to help write this script.",
    "How many people will you test with?",
    "How will you reach out to people so that you can test with a diverse group?",
  ],
  Observation: [
    "Did the user know what button to tap?",
    "Did the user know how to use the interface?",
    "Was the user ever confused? At what point?",
    "Did the user enjoy the product/ app?",
    "Did the user smile or laugh at specific points?",
    "Did you observe anything else?",
  ],
  Interview: [
    "What did you like and not like about the product/ app?",
    "Is the product/ app useful? Would you use a product/ app like this?",
    "What else might you want to see in this product/ app?",
  ],
  Reiterate: [
    "As you repeat the design cycle, think about what you learned from your evaluation. Did problems come up, and if so, how can you fix them? How can you improve your product/ app?",
    "Is your product/ app innovative? Does it do something that existing product/ apps don't do? Is it a product/ app someone would use over and over again? How can you improve your product/ app?",
    "Now it's time to reflect on your product/ app. Ask yourself what's exciting about your product/ app idea. If nothing comes to mind, try returning to your list on the Ideas slide. Not all ideas work out.",
    "If you decide to continue with your original product/ app idea, think about what you learned from your evaluation. What did your product/ app do well? What could you improve?",
  ],
  "BMC Canvas": [
    "Key Partners, Key Activities, Key Resources, Value Propositions, Customer Relationships, Channels, Customer Segments, Cost Structures, Revenue Streams.",
  ],
  "Customer Sales Pitch": [
    "Identifying Needs and Priorities",
    "Assessing Current Solutions",
    "Evaluating Fit and Value",
    "Solution Overview",
    "Market Fit",
    "Feedback and Questions",
  ],
  "Final Pitch Deck": [
    "You've tested and improved your product/ app idea. Now it's time to polish it up and share it! Make a three-minute presentation or video of your pitch.",
    "Why: The problem your product/ app is trying to solve.",
    "Who: A description of who your product/ app is for.",
    "What: An overview of the product/ app.",
    "How: Details about the UX and UI, including: the design, the features, the coding concepts it uses, the prototype and any visuals, and improvements made based on user testing.",
  ],
};

/** Exact questions for a playbook step (prefer step.questions, else bank, else discussion+task). */
function getExactPlaybookQuestions(dtStep) {
  if (!dtStep?.step) return [];
  if (Array.isArray(dtStep.questions) && dtStep.questions.length) {
    return dtStep.questions.map((q) => String(q || "").trim()).filter(Boolean);
  }
  const banked = DT_PLAYBOOK_QUESTIONS[String(dtStep.step)];
  if (Array.isArray(banked) && banked.length) return banked.slice();
  const fallback = [];
  if (dtStep.discussionPrompt) fallback.push(String(dtStep.discussionPrompt).trim());
  if (dtStep.realProjectTask) fallback.push(String(dtStep.realProjectTask).trim());
  return fallback.filter(Boolean);
}

/** Rotating Problem Review prompts — DT Playbook jargon only (fallback if step unknown) */
const DT_PROBLEM_REVIEW_ANGLES = [
  `▶ ${DT_PROBLEM_BREAKDOWN.brainstormList}`,
  `▶ ${DT_PROBLEM_BREAKDOWN.oneSentence}`,
  `▶ ${DT_PROBLEM_BREAKDOWN.whatDoYouKnow}`,
  `▶ ${DT_PROBLEM_BREAKDOWN.whoCares}`,
  `▶ ${DT_PROBLEM_BREAKDOWN.whatQuestions}`,
];

module.exports = {
  DT_PLAYBOOK,
  DT_PROBLEM_BREAKDOWN,
  DT_PLAYBOOK_QUESTIONS,
  DT_PROBLEM_REVIEW_ANGLES,
  getExactPlaybookQuestions,
};