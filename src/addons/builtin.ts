/**
 * The add-ons that ship enabled. All of them are data.
 *
 * Every path here was written against a captured response rather than guessed,
 * and every one is covered by a fixture in tests/fixtures. When a platform
 * changes shape the fixture is what breaks, which is the point: a silent
 * breakage becomes a red test.
 *
 * Reading: `at` selects a position in the response, with `[]` fanning out over
 * an array. Every `media` path is relative to that position, and a leading `^`
 * steps out to an ancestor. So with `at` ending in `...variants[]`, `url` is a
 * field of the variant, `^id` belongs to the media that owns it, and `^^^^id`
 * reaches the post.
 *
 * Scope note: these cover JSON APIs only. Reading media out of a page global
 * such as Bandcamp's TralbumData, or scraping a client id out of a JavaScript
 * bundle, is a different extension point and is deliberately not attempted
 * here. See LIMITATIONS.md.
 */

import type { AddonSpec, MediaSpec, RuleSpec } from '../core/types';

/*
 * X serves the same tweet objects from several endpoints, each at a different
 * depth in its response. A single rule only covers one of them, which is what
 * the first version of this add-on got wrong: it handled a tweet opened
 * directly and nothing else, so scrolling a timeline found nothing.
 *
 * The media spec is shared and entirely relative, so it does not care how deep
 * the tweet sits. From a variant, `^` is the media object and `^^` is the tweet
 * it belongs to, whatever the path that got us there.
 */

const X_TWEET_PATHS = [
  /* A tweet opened directly. */
  'data.tweetResult.result',
  /* The signed-in home timeline. Confirmed against a live HomeTimeline
     response, which nests one level deeper than a conversation. */
  'data.home.home_timeline_urt.instructions[].entries[].content.itemContent.tweet_results.result',
  /* A conversation opened from a tweet. */
  'data.threaded_conversation.instructions[].entries[].content.itemContent.item',
  'data.threaded_conversation.instructions[].entries[].content.itemContent.tweet_results.result',
  /* Search, confirmed against a live SearchTimeline response. */
  'data.search_by_raw_query.search_timeline.timeline.instructions[].entries[].content.itemContent.tweet_results.result',
  'data.user.result.timeline_v2.timeline.instructions[].entries[].content.itemContent.item',
  'data.user.result.timeline_v2.timeline.instructions[].entries[].content.itemContent.tweet_results.result',
];

/*
 * The ladder, from a variant in `video_info.variants`:
 *
 *   ^    video_info   duration
 *   ^^   media        id, poster frame, alt text, original_info dimensions
 *   ^^^  extended_entities
 *   ^^^^ the tweet    author on it, its text, date and id under legacy
 *
 * From a photo, which is the media object itself, the tweet is only two steps
 * up. Keeping both counts next to each other is the whole point of writing
 * them out.
 */
const X_VIDEO: MediaSpec = {
  url: 'url',
  mime: 'content_type',
  bitrate: 'bitrate',
  width: '^^original_info.width',
  height: '^^original_info.height',
  duration: '^duration_millis',
  group: '^^id_str',
  thumbnail: '^^media_url_https',
  alt: '^^ext_alt_text',
  caption: '^^^^legacy.full_text',
  author: '^^^^core.user_results.result.core.name',
  published: '^^^^legacy.created_at',
  postId: '^^^^legacy.id_str',
  postUrl: { template: 'https://x.com/i/status/{id}', values: { id: '^^^^legacy.id_str' } },
  timeFormat: 'epoch-millis',
};

const X_PHOTO: MediaSpec = {
  // Without this a video's poster frame is offered as if it were a rendition.
  when: { path: 'type', equals: 'photo' },
  url: 'media_url_https',
  width: 'original_info.width',
  height: 'original_info.height',
  group: 'id_str',
  alt: 'ext_alt_text',
  caption: '^^legacy.full_text',
  author: '^^core.user_results.result.core.name',
  published: '^^legacy.created_at',
  postId: '^^legacy.id_str',
  postUrl: { template: 'https://x.com/i/status/{id}', values: { id: '^^legacy.id_str' } },
};

/*
 * Some endpoints nest the media inside `legacy` rather than beside it, which
 * moves the tweet one level further away and changes every ancestor depth.
 * Confirmed against a live TweetDetail response, which uses a different root
 * name again.
 */
const X_TWEET_PATHS_NESTED = [
  'data.threaded_conversation_with_injections_v2.instructions[].entries[].content.itemContent.tweet_results.result.legacy',
  'data.threaded_conversation_with_injections_v2.instructions[].entries[].content.itemContent.item.legacy',
];

/*
 * With the media inside `legacy`, the tweet is one step further away, so every
 * caret count below is one higher than in the shape above.
 *
 * The video rule ends on a variant, so its ladder is:
 *   ^    video_info
 *   ^^   media
 *   ^^^  extended_entities
 *   ^^^^ legacy    text, date, id
 *   ^^^^^ result   author
 * The photo rule ends on the media object itself, two steps shallower.
 */
const X_VIDEO_NESTED: MediaSpec = {
  url: 'url',
  mime: 'content_type',
  bitrate: 'bitrate',
  duration: '^duration_millis',
  width: '^^original_info.width',
  height: '^^original_info.height',
  group: '^^id_str',
  thumbnail: '^^media_url_https',
  alt: '^^ext_alt_text',
  caption: '^^^^full_text',
  author: '^^^^^core.user_results.result.core.name',
  published: '^^^^created_at',
  postId: '^^^^id_str',
  postUrl: { template: 'https://x.com/i/status/{id}', values: { id: '^^^^id_str' } },
  timeFormat: 'epoch-millis',
};

const X_PHOTO_NESTED: MediaSpec = {
  url: 'media_url_https',
  width: 'original_info.width',
  height: 'original_info.height',
  group: 'id_str',
  alt: 'ext_alt_text',
  caption: '^^full_text',
  author: '^^^core.user_results.result.core.name',
  published: '^^created_at',
  postId: '^^id_str',
  postUrl: { template: 'https://x.com/i/status/{id}', values: { id: '^^id_str' } },
};

const xRules: RuleSpec[] = [
  ...X_TWEET_PATHS.flatMap((prefix) => [
    { at: `${prefix}.extended_entities.media[].video_info.variants[]`, media: X_VIDEO },
    { at: `${prefix}.extended_entities.media[]`, media: X_PHOTO },
  ]),
  ...X_TWEET_PATHS_NESTED.flatMap((prefix) => [
    { at: `${prefix}.extended_entities.media[].video_info.variants[]`, media: X_VIDEO_NESTED },
    { at: `${prefix}.extended_entities.media[]`, media: X_PHOTO_NESTED },
  ]),
];

export const BUILTIN_ADDONS: readonly AddonSpec[] = [
  {
    id: 'x',
    name: 'X / Twitter',
    hosts: ['x.com', 'twitter.com'],
    apiPaths: ['/i/api/'],
    /*
     * No URL rewrite here, deliberately.
     *
     * Forcing name=orig looks like a free upgrade and is not: verified against
     * x.com while signed in, plenty of pbs.twimg images have no original and
     * the rewritten URL returns 404. A 404 is worse than a smaller image, so
     * the original URL is kept. The capability remains, and other add-ons use
     * it; this one does not.
     */
    rules: xRules,
  },

  {
    id: 'reddit',
    name: 'Reddit',
    hosts: ['reddit.com', 'redd.it'],
    apiPaths: ['/api/', '/graphql', '/svc/'],
    rules: [
      {
        at: 'data.children[].data.secure_media.reddit_video',
        media: {
          url: 'fallback_url',
          mime: 'scrubber_media_type',
          width: 'width',
          height: 'height',
          duration: 'duration',
          caption: '^^title',
          author: '^^author',
          published: '^^created_utc',
          postId: '^^id',
          postUrl: { template: 'https://www.reddit.com{id}', values: { id: '^^permalink' } },
          timeFormat: 'epoch-seconds',
        },
      },
    ],
  },

  {
    id: 'instagram',
    name: 'Instagram',
    hosts: ['instagram.com', 'threads.net'],
    apiPaths: ['/api/', '/graphql'],
    rules: [
      {
        at: 'items[].video_versions[]',
        media: {
          url: 'url',
          width: 'width',
          height: 'height',
          group: '^id',
          caption: '^caption.text',
          author: '^user.username',
          thumbnail: '^image_versions2.candidates[0].url',
          published: '^taken_at',
          duration: '^video_duration',
          postId: '^id',
          postUrl: {
            template: 'https://www.instagram.com/p/{code}/',
            values: { code: '^code' },
          },
          timeFormat: 'epoch-seconds',
        },
      },
      {
        at: 'items[].image_versions2.candidates[]',
        media: {
          url: 'url',
          width: 'width',
          height: 'height',
          group: '^id',
          caption: '^caption.text',
          author: '^user.username',
          published: '^taken_at',
          postId: '^id',
          postUrl: {
            template: 'https://www.instagram.com/p/{code}/',
            values: { code: '^code' },
          },
          timeFormat: 'epoch-seconds',
        },
      },
    ],
  },

  {
    id: 'tiktok',
    name: 'TikTok',
    hosts: ['tiktok.com'],
    apiPaths: ['/api/'],
    rules: [
      {
        at: 'itemStruct.video',
        media: {
          url: 'playAddr.urlList[0]',
          width: 'width',
          height: 'height',
          duration: 'duration',
          group: '^id',
          caption: '^desc',
          author: '^author.uniqueId',
          thumbnail: '^cover',
          published: '^createTime',
          postId: '^id',
          postUrl: {
            template: 'https://www.tiktok.com/@{handle}/video/{id}',
            values: { handle: '^author.uniqueId', id: '^id' },
          },
          timeFormat: 'epoch-seconds',
        },
      },
    ],
  },

  {
    id: 'imgur',
    name: 'Imgur',
    hosts: ['api.imgur.com', 'imgur.com'],
    apiPaths: ['/3/', '/api/'],
    rules: [
      {
        at: 'data',
        media: {
          url: 'mp4',
          width: 'width',
          height: 'height',
          group: 'id',
          caption: 'title',
          author: 'account_url',
          published: 'datetime',
          postId: 'id',
          postUrl: { template: 'https://imgur.com/{id}', values: { id: 'id' } },
          timeFormat: 'epoch-seconds',
        },
      },
      {
        at: 'data.images[]',
        media: {
          url: 'link',
          mime: 'type',
          width: 'width',
          height: 'height',
          group: 'id',
          caption: '^title',
          author: '^account_url',
          postId: '^id',
          postUrl: { template: 'https://imgur.com/{id}', values: { id: '^id' } },
        },
      },
    ],
  },

  {
    id: 'bsky',
    name: 'Bluesky',
    hosts: ['bsky.app', 'bsky.social', 'api.bsky.app'],
    apiPaths: ['/xrpc/app.bsky.feed.'],
    rules: [
      {
        at: 'feed[].post.embed.app.bsky.embed.video',
        media: {
          url: 'playlist.url',
          mime: 'playlist.mimeType',
          caption: '^^^^^record.text',
          author: '^^^^^author.handle',
          thumbnail: '^thumbnail.url',
          published: '^^^^^indexedAt',
          postId: { last: '^^^^^uri' },
          postUrl: {
            template: 'https://bsky.app/profile/{handle}/post/{rkey}',
            values: { handle: '^^^^^author.handle', rkey: { last: '^^^^^uri' } },
          },
        },
      },
    ],
  },

  {
    id: 'twitch',
    name: 'Twitch',
    hosts: ['gql.twitch.tv'],
    apiPaths: ['/gql'],
    rules: [
      {
        at: 'data.video.videoQualities[]',
        media: {
          // Twitch declares no mime, so the rule asserts it. The VOD endpoints
          // all serve a playlist whatever the "quality" says.
          mime: { literal: 'application/vnd.apple.mpegurl' },
          url: 'sourceURL',
          label: 'quality',
          group: '^id',
          thumbnail: '^thumbnailURL',
          caption: '^title',
          author: '^owner.login',
          duration: '^lengthSeconds',
          published: '^createdAtSeconds',
          postId: '^id',
          postUrl: { template: 'https://www.twitch.tv/videos/{id}', values: { id: '^id' } },
          timeFormat: 'epoch-seconds',
        },
      },
    ],
  },

  {
    id: 'facebook',
    name: 'Facebook',
    hosts: ['facebook.com', 'fbcdn.net'],
    apiPaths: ['/api/graphql', '/ajax/relay-ef', '/video/unified_cvc'],
    rewrite: [
      {
        host: 'video.xx.fbcdn.net',
        removeParams: ['s', 'oe'],
      },
    ],
    rules: [
      {
        at: 'data.video',
        media: {
          url: 'browser_native_hd_url',
          mime: { literal: 'video/mp4' },
          label: { literal: 'HD' },
          caption: 'description',
          author: 'from.name',
          published: 'created_time',
          postId: 'id',
          postUrl: { template: 'https://www.facebook.com/watch/?v={id}', values: { id: 'id' } },
          timeFormat: 'epoch-seconds',
        },
      },
      {
        at: 'data.video',
        media: {
          url: 'browser_native_sd_url',
          mime: { literal: 'video/mp4' },
          label: { literal: 'SD' },
          caption: 'description',
          author: 'from.name',
          published: 'created_time',
          postId: 'id',
          postUrl: { template: 'https://www.facebook.com/watch/?v={id}', values: { id: 'id' } },
          timeFormat: 'epoch-seconds',
        },
      },
    ],
  },
];
