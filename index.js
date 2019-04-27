require('dotenv').config();
require('./logo');

const argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .default('type', 'random')
  .array('effects')
  .choices('type', ['still', 'gif', 'random'])
  .boolean('post')
  .describe('post', 'Upload image to the destinations')
  .describe('effects', 'Apply a specific GIF effect (by name)')
  .describe('local', 'Local folder to read videos from instead of S3')
  .describe('caption', 'Use a particular caption glob')
  .describe('type', 'The type of image generated').argv;

const stills = require('stills');
const { resolve } = require('path');
const { compact, random, sampleSize, get } = require('lodash');
const FieriFiction = require('fierifiction');

const {
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_BUCKET,
  TUMBLR_CONSUMER_KEY,
  TUMBLR_CONSUMER_SECRET,
  TUMBLR_ACCESS_TOKEN_KEY,
  TUMBLR_ACCESS_TOKEN_SECRET,
  TUMBLR_BLOG_NAME,
  TUMBLR_REBLOG_BLOG_NAME,
  TWITTER_CONSUMER_KEY,
  TWITTER_CONSUMER_SECRET,
  TWITTER_ACCESS_TOKEN_KEY,
  TWITTER_ACCESS_TOKEN_SECRET,
  POST_TEXT_GENERATOR_URL,
  GIF_EFFECT_RATE,
  WATSON_API_KEY
} = process.env;

const { local, effects, caption } = argv;

const GIF_STILL_RATE = 0.5;
const CAPTION_RATE = caption ? 1 : 0.8;
const USE_GIF_EFFECT_RATE = GIF_EFFECT_RATE ? parseFloat(GIF_EFFECT_RATE) : 0.2;

const fiction = new FieriFiction({
  tumblrConsumerKey: TUMBLR_CONSUMER_KEY,
  tumblrConsumerSecret: TUMBLR_CONSUMER_SECRET,
  tumblrTokenKey: TUMBLR_ACCESS_TOKEN_KEY,
  tumblrTokenSecret: TUMBLR_ACCESS_TOKEN_SECRET,
  tumblrBlogName: TUMBLR_REBLOG_BLOG_NAME,
  watsonApiKey: WATSON_API_KEY,
  textGeneratorUrl: POST_TEXT_GENERATOR_URL
});

const randomly = (rate, hit = true, miss = false) =>
  Math.random() < rate ? hit : miss;

const source = local
  ? new stills.sources.Local({
      folder: local
    })
  : new stills.sources.S3({
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      bucket: S3_BUCKET
    });

const type =
  argv.type === 'random' ? randomly(GIF_STILL_RATE, 'gif', 'still') : argv.type;

const isGif = type === 'gif';

const content = isGif ? new stills.content.Gif() : new stills.content.Still();

const allEffects = [
  new stills.filters.FaceZoom({
    lastFrameDelayMs: 500,
    startPosition: 0.9
  }),
  new stills.filters.Distortion({
    heightFactor: random(0.4, 0.6)
  }),
  new stills.filters.Station(),
  new stills.filters.Shuffle(),
  new stills.filters.Stutter({
    numFrames: random(6, 16),
    stutterDelay: 0
  }),
  new stills.filters.Tint({
    factor: 1.7
  }),
  new stills.filters.Invert(),
  new stills.filters.Gray(),
  new stills.filters.Reverse(),
  new stills.filters.Implode(),
  new stills.filters.Swirl(),
  new stills.filters.Rotate()
];

let useEffects = [];

if (isGif) {
  useEffects = effects
    ? allEffects.filter(e => effects.indexOf(e.name) !== -1)
    : randomly(USE_GIF_EFFECT_RATE, sampleSize(allEffects), []);
}

const filters = compact([
  ...useEffects,
  randomly(
    CAPTION_RATE,
    new stills.filters.Captions({
      captionFileGlob: caption ? `*${caption}*` : undefined,
      folder: resolve('./captions'),
      font: resolve('./fonts/arial.ttf'),
      isSequential: true,
      num: {
        srt: random(1, 2),
        txt: 1
      }
    })
  )
]);

const destinations = argv.post
  ? [
      new stills.destinations.Tumblr({
        consumerKey: TUMBLR_CONSUMER_KEY,
        consumerSecret: TUMBLR_CONSUMER_SECRET,
        token: TUMBLR_ACCESS_TOKEN_KEY,
        tokenSecret: TUMBLR_ACCESS_TOKEN_SECRET,
        blogName: TUMBLR_BLOG_NAME
      }),
      new stills.destinations.Twitter({
        consumerKey: TWITTER_CONSUMER_KEY,
        consumerSecret: TWITTER_CONSUMER_SECRET,
        accessTokenKey: TWITTER_ACCESS_TOKEN_KEY,
        accessTokenSecret: TWITTER_ACCESS_TOKEN_SECRET
      })
    ]
  : [];

const taggers = [
  new stills.taggers.Episode(),
  new stills.taggers.Static({
    tags: ['guy fieri', 'guyfieri', 'diners drive-ins and dives']
  }),
  new stills.taggers.Captions(),
  new stills.taggers.Filters({
    shuffle: 'tw:flashing',
    stutter: 'tw:flashing'
  })
];

(async function() {
  console.log(`🏃 Running in ${local ? 'local' : 'S3'} mode`);

  const result = await stills.generate({
    source,
    content,
    filters,
    destinations,
    taggers
  });

  const output = result.content;
  const captions = get(result, 'filters.captions', []);
  const tumblr = get(result, 'destinations.tumblr');
  const tags = get(tumblr, 'tags', []);
  const reblog = tumblr
    ? {
        url: tumblr.url
      }
    : null;
  if (destinations.length) {
    if (captions.length) {
      await fiction.post(output, captions, tags, reblog);
    }
    stills.deleteStills(result);
  }
})();
