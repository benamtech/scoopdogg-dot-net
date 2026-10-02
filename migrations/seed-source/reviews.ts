export const GOOGLE_PROFILE_URL = 'https://share.google/nt1A1k6dxX8r6KWni';

export interface Review {
  id: string;
  name: string;
  reviewerBadge?: string;
  date: string;
  quote: string;
  googleUrl: string | null;
}

export const FEATURED_REVIEWS: Review[] = [
  {
    id: 'wendy-ramirez',
    name: 'Wendy Ramirez',
    date: '3 months ago',
    quote: "Josue is excellent! I can't say enough good things about his service. He's extremely reliable and always shows up when scheduled. What really stands out is how efficient and precise he is. He works fast but never cuts corners. My yard is completely clean every time.",
    googleUrl: 'https://share.google/1YfuyjdPDmrwElnzD',
  },
  {
    id: 'amber-morua',
    name: 'Amber Morua',
    reviewerBadge: 'Local Guide',
    date: '4 months ago',
    quote: "So glad I found Scoop Dogg service! They're reliable, super friendly, and always do a great job keeping my yard clean. The pricing is affordable, and their customer service is awesome; easy to reach and great to work with. It's such a relief not having to worry about cleanup anymore. I'd definitely recommend them to any dog owner.",
    googleUrl: 'https://share.google/1R9nn6n3NymASlzm9',
  },
  {
    id: 'cheyenne-crafton',
    name: 'Cheyenne Crafton',
    date: '8 months ago',
    quote: "I had a fantastic experience with Scoop Dogg! Josue truly knows his craft when it comes to landscape and turf maintenance. He was professional, reliable, and attentive to detail from start to finish. My yard has never looked better! I highly recommend Scoop Dogg to anyone looking for top-quality landscaping services. Will definitely be using their services again!",
    googleUrl: 'https://share.google/nGmM4jYxOxJtTAVQT',
  },
  {
    id: 'jacquelyn-gargano',
    name: 'Jacquelyn Gargano',
    date: '4 months ago',
    quote: "Josue does a fantastic job! Reliable and always leaves my yard looking fresh. Good communication as well. Can't recommend enough!",
    googleUrl: 'https://share.google/06UiBMRr0Bwl8Jxnv',
  },
  {
    id: 'ilse-fuentes',
    name: 'Ilse Fuentes',
    date: '5 months ago',
    quote: "Josue was amazing! He did a great job making my backyard clean and enjoyable again. He really went above and beyond, great communication, and knew exactly what to do! 10/10",
    googleUrl: 'https://share.google/Qnc99qTgN9sE6sQFi',
  },
  {
    id: 'alex-torres',
    name: 'Alex Torres',
    reviewerBadge: 'Local Guide',
    date: '8 months ago',
    quote: "Josué is simply the best. He is dependable, kind, and takes great pride in his work. Every visit is thorough and done with care, and he always goes the extra mile to make sure everything looks perfect. I count on him weekly, and he has gladly helped with tasks beyond his usual duties whenever asked. Even our dogs light up when he arrives, which speaks volumes about his character. I recommend Scoop Dogg without hesitation.",
    googleUrl: 'https://share.google/rFb5SkpEq3aY41Zfw',
  },
  {
    id: 'zenia-padron',
    name: 'Zenia Padron',
    date: '5 months ago',
    quote: "Josue does great — he's been sanitizing my patio for a couple of months. Have no complaints, I highly recommend him, great service.",
    googleUrl: 'https://share.google/yJbQE5zlDXxPE9dLk',
  },
  {
    id: 'vic-star',
    name: 'Vic Star',
    reviewerBadge: 'Local Guide',
    date: '8 months ago',
    quote: "Having two large dogs it's very necessary to keep my turf clean and I couldn't do it all by myself. This is why I recommend Jose and his services to be necessary for any dog owners who have turf in their backyard in Ventura County. We have been using them for over six months and were referred over by a neighbor — now have 10 people going to him. Thank you for all the work.",
    googleUrl: 'https://share.google/JSgDyiw3JPk5uXNCr',
  },
  {
    id: 'l-o',
    name: 'L O',
    date: 'a year ago',
    quote: "I recently had the pleasure of using Scoop Dogg's services, and I couldn't be more impressed! Josue, the manager, did an exceptional job cleaning my yard of dog waste. Not only was he fast and efficient, but he also displayed a level of kindness and professionalism that truly stood out. Josue went above and beyond to ensure every corner of my yard was spotless, leaving it cleaner than it's ever been. If you're looking for a reliable and top-notch dog waste removal service, I highly recommend Scoop Dogg and Josue. They are simply the best!!",
    googleUrl: 'https://share.google/nVvJesagExINaF0T2',
  },
  {
    id: 'capital-maintenance',
    name: 'Capital Maintenance',
    date: '8 months ago',
    quote: "Amazing service! Our Astro turf was clean and sanitized and I felt safe with my kids running on it barefoot. We had family come over the afternoon after the service and they thought the Astro turf was brand new and installed recently (we have had it for 3 years now)! I will be using this service every few months!",
    googleUrl: 'https://share.google/mQso7CT50xoJ3skhe',
  },
  {
    id: 'annie-gandy',
    name: 'Annie Gandy',
    date: '5 days ago',
    quote: "On time, reviewed with me and did a thorough job!!!! I'm very pleased!",
    googleUrl: 'https://share.google/F8nJ7RmhpRRI1AhXk',
  },
];

export const MORE_REVIEWS: Review[] = [
  {
    id: 'nancy-robles',
    name: 'Nancy Robles',
    date: '6 months ago',
    quote: "Josue does amazing — has been doing my backyard for more than 6 months and does amazing at it, highly recommend!",
    googleUrl: null,
  },
  {
    id: 'carrie',
    name: 'Carrie',
    reviewerBadge: 'Local Guide',
    date: '8 months ago',
    quote: "Scoop Dogg is AMAZING!!! Josue always goes above and beyond for us! I cannot say enough great things! I appreciate his service greatly!!!",
    googleUrl: null,
  },
  {
    id: 'alec-edgerton',
    name: 'Alec Edgerton',
    date: '5 months ago',
    quote: "He does a great job cleaning the yard and deodorizing the property. Always is great at communicating and has good prices.",
    googleUrl: null,
  },
  {
    id: 'kas-s',
    name: 'Kas S',
    date: '5 months ago',
    quote: "Excellent service and extremely kind. Josue gets the job done!! Highly recommended.",
    googleUrl: null,
  },
  {
    id: 'marcos-isaac',
    name: 'Marcos Isaac',
    reviewerBadge: 'Local Guide',
    date: 'a year ago',
    quote: "Amazing service! Glad I found them cause man oh man was my yard a mess! I have 3 huskies and they go at least 4 times a day — what a blessing!",
    googleUrl: null,
  },
  {
    id: 'james-devitt',
    name: 'James Devitt',
    reviewerBadge: 'Local Guide',
    date: '8 months ago',
    quote: "Very reliable — always lets you know when he is coming so no surprises. Good price too.",
    googleUrl: null,
  },
  {
    id: 'louis-vargas',
    name: 'Louis Vargas',
    date: '8 months ago',
    quote: "Very great job. Would recommend contacting Scoop Dogg!",
    googleUrl: null,
  },
];
