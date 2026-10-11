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
 * Scope note: these read either a JSON API or, where a site has no API anyone
 * may call, JSON that the site renders into its own page. Reading a page
 * global such as Bandcamp's TralbumData, or scraping a client id out of a
 * JavaScript bundle, is still a different extension point and is deliberately
 * not attempted here. See LIMITATIONS.md.
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
  /*
   * The signed-in home timeline.
   *
   * Two shapes are covered. The nested rules read media inside legacy; the
   * sibling shape still appears on other entry points.
   */
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
  /*
   * Without this a video's poster frame is offered as if it were a rendition:
   * a video media object carries a media_url_https too, so the same tweet
   * arrives with both its video and its thumbnail as separate downloads.
   */
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
const X_TWEET_RESULTS_NESTED = [
  'data.threaded_conversation_with_injections_v2.instructions[].entries[].content.itemContent.tweet_results.result.legacy',
  'data.threaded_conversation_with_injections_v2.instructions[].entries[].content.itemContent.item.legacy',
  /*
   * The home timeline, which is where most scrolling happens. Confirmed
   * against a live HomeTimeline response: 45 media objects, 9 of them video,
   * media nested under legacy exactly as a conversation nests it. Without this
   * rule the timeline produced rows from the network sniffer only, with no
   * author, no caption and no grouping
   */
  'data.home.home_timeline_urt.instructions[].entries[].content.itemContent.tweet_results.result.legacy',
  'data.home.home_timeline_urt.instructions[].entries[].content.items[].item.itemContent.tweet_results.result.legacy',
  /* Search, confirmed against a live SearchTimeline response. */
  'data.search_by_raw_query.search_timeline.timeline.instructions[].entries[].content.itemContent.tweet_results.result.legacy',
  /*
   * A profile. The root is timeline.timeline, not timeline_v2.timeline; the
   * older spelling is kept below with the sibling shapes it belongs to.
   */
  'data.user.result.timeline.timeline.instructions[].entries[].content.itemContent.tweet_results.result.legacy',
  'data.user.result.timeline.timeline.instructions[].entries[].content.items[].item.itemContent.tweet_results.result.legacy',
  'data.bookmark_timeline_v2.timeline.instructions[].entries[].content.itemContent.tweet_results.result.legacy',
  'data.bookmark_timeline_v2.timeline.instructions[].entries[].content.items[].item.itemContent.tweet_results.result.legacy',
  'data.explore_page.body.initialTimeline.timeline.timeline.instructions[].entries[].content.itemContent.tweet_results.result.legacy',
  'data.explore_page.body.initialTimeline.timeline.timeline.instructions[].entries[].content.items[].item.itemContent.tweet_results.result.legacy',
];

/**
 * A quoted tweet arrives as a whole second result object under the tweet
 * quoting it, with its own legacy and its own media. Every timeline carries
 * them, so every path above has a quoted twin rather than each being written
 * out twice.
 */
function withQuoted(paths: readonly string[]): string[] {
  const quoted = paths.map((path) =>
    path.replace(
      '.tweet_results.result.legacy',
      '.tweet_results.result.quoted_status_result.result.legacy',
    ),
  );
  /* A path that has no tweet_results is returned unchanged by the replace. */
  return [...new Set([...paths, ...quoted])];
}

const X_TWEET_PATHS_NESTED = withQuoted(X_TWEET_RESULTS_NESTED);

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
  /* The same guard as the sibling shape, which was missing here. */
  when: { path: 'type', equals: 'photo' },
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

/*
 * The font file URL, in the form Adobe's own web embed kit uses.
 *
 * The ec_token is required: without it the CDN answers 403. Adobe publishes it
 * for exactly this purpose and TypeRip, which does the same job outside the
 * browser, carries the same string. Verified 2026-02-18 against a family page
 * (75,652 bytes) and a collection page (287,204 bytes), both application/font-woff2.
 *
 * If Adobe ever rotates it, this is the one line to change, and the URL shape
 * around it is unaffected.
 */
const ADOBE_FONT_URL =
  'https://use.typekit.net/pf/tk/{kit}/{fvd}/l?unicode=AAAAAQAAAAEAAAAB&features=ALL&v=3&ec_token=3bb2a6e53c9684ffdc9a9bf71d5b2a620e68abb153386c46ebe547292f11a96176a59ec4f0c7aacfef2663c08018dc100eedf850c284fb72392ba910777487b32ba21c08cc8c33d00bda49e7e2cc90baff01835518dde43e2e8d5ebf7b76545fc2687ab10bc2b0911a141f3cf7f04f3cac438a135f';

/*
 * Instagram.
 *
 * These read the shapes instagram.com serves today. `items[]`, which the
 * api/v1/feed/user endpoints return, appears on no surface captured here and
 * is not covered.
 *
 * What the site serves now puts a media object at the end of a path that
 * differs per surface and nowhere else. The field layout inside that object is
 * the same every time, so one set of media specs covers all of them:
 *
 *   image        image_versions2.candidates[]   each with url, width, height
 *   video        video_versions[]                each with url, width, height
 *   carousel     carousel_media[]                media objects, all over again
 *
 * media_type is 1 for an image, 2 for a video and 8 for a carousel. A video
 * also carries a poster in image_versions2, so without a guard every video
 * arrives with its own thumbnail as a second download.
 *
 * A carousel child repeats the whole structure one level down, which moves the
 * post another level away. The caret counts differ between the two sets for
 * that reason, and mixing them up is the mistake that reads as "the rules look
 * right".
 */
/*
 * Depth is the whole difficulty here. For a media object at P:
 *
 *   …media.image_versions2.candidates[]   candidate   ^^ is P
 *   …media.video_versions[]               version     ^  is P
 *   …media.carousel_media[].image_versions2.candidates[]
 *                                         candidate   ^^ is the child, ^^^ is P
 *   …media.carousel_media[].video_versions[]
 *                                         version     ^  is the child, ^^ is P
 */
const igImage: MediaSpec = {
  url: 'url',
  width: 'width',
  height: 'height',
  group: '^^id',
  /* A poster must not be offered again as the image it belongs to. */
  when: { path: '^^video_versions', absent: true },
  caption: '^^caption.text',
  author: '^^user.username',
  published: '^^taken_at',
  postId: '^^pk',
  postUrl: { template: 'https://www.instagram.com/p/{code}/', values: { code: '^^code' } },
  timeFormat: 'epoch-seconds',
};

const igVideo: MediaSpec = {
  url: 'url',
  width: 'width',
  height: 'height',
  bitrate: 'bandwidth',
  group: '^id',
  thumbnail: '^image_versions2.candidates[0].url',
  duration: '^video_duration',
  caption: '^caption.text',
  author: '^user.username',
  published: '^taken_at',
  postId: '^pk',
  postUrl: { template: 'https://www.instagram.com/p/{code}/', values: { code: '^code' } },
  timeFormat: 'epoch-seconds',
};

const igChildImage: MediaSpec = {
  url: 'url',
  width: 'width',
  height: 'height',
  group: '^^id',
  when: { path: '^^video_versions', absent: true },
  caption: '^^^caption.text',
  author: '^^^user.username',
  published: '^^^taken_at',
  postId: '^^^pk',
  postUrl: { template: 'https://www.instagram.com/p/{code}/', values: { code: '^^^code' } },
  timeFormat: 'epoch-seconds',
};

/*
 * One level shallower than the child image, and not by mistake: writing
 * `video_versions[]` as a single segment means the fan replaces that segment
 * rather than sitting inside it, while `image_versions2.candidates[]` keeps
 * image_versions2 as a step of its own. The same caret therefore reaches a
 * different object in each, which is the easiest thing in this file to get
 * wrong and impossible to spot without a test.
 */
const igChildVideo: MediaSpec = {
  url: 'url',
  width: 'width',
  height: 'height',
  bitrate: 'bandwidth',
  group: '^id',
  thumbnail: '^image_versions2.candidates[0].url',
  duration: '^^video_duration',
  caption: '^^caption.text',
  author: '^^user.username',
  published: '^^taken_at',
  postId: '^^pk',
  postUrl: { template: 'https://www.instagram.com/p/{code}/', values: { code: '^^code' } },
  timeFormat: 'epoch-seconds',
};

/**
 * Every path that has been seen to end at a media object, captured rather than
 * assumed. Each is one entry point on the site; the object at the end of them
 * all is the same shape.
 */
const IG_MEDIA_PATHS = [
  /* The signed-in home feed. */
  'data.xdt_api__v1__feed__timeline__connection.edges[].node.media',
  'data.xdt_api__v1__feed__timeline__connection.edges[].node.explore_story.media',
  /* A profile's posts. Same connection, different name. */
  'data.xdt_api__v1__feed__user_timeline_graphql_connection.edges[].node.media',
  /* Explore, which is not a connection at all. */
  'sectional_items[].layout_content.medias[].media',
  'sectional_items[].layout_content.medias[].clips.items[].media',
  /* Reels, served through a separate fetch. */
  'data.fetch__XDTUserDict.clips_connection.edges[].node.media',
  /* Promoted posts and story units carry media too. */
  'data.xdt_api__v1__feed__timeline__connection.edges[].node.ad.items[]',
  'data.xdt_injected_story_units.ad_media_items[].items[]',
];

const instagramRules: RuleSpec[] = IG_MEDIA_PATHS.flatMap((path) => [
  { at: `${path}.video_versions[]`, media: igVideo },
  { at: `${path}.image_versions2.candidates[]`, media: igImage },
  { at: `${path}.carousel_media[].video_versions[]`, media: igChildVideo },
  { at: `${path}.carousel_media[].image_versions2.candidates[]`, media: igChildImage },
]);

/*
 * One pin, wherever it is found. `orig` is the rendition Pinterest itself
 * serves for downloads; the 236x/474x/736x entries are what the grid shows.
 */
const PINTEREST_PIN: MediaSpec = {
  url: 'images.orig.url',
  width: 'images.orig.width',
  height: 'images.orig.height',
  /*
   * No thumbnail. The smaller renditions are keyed `236x`, `474x` and `736x`,
   * and the path language cannot address a key beginning with a digit, so a
   * preview row loads the original. That costs bandwidth on a feed of two
   * thousand pins, which is worth fixing, but not by teaching the parser one
   * more grammar rule for a single site.
   */
  caption: 'grid_title',
  alt: 'auto_alt_text',
  author: 'pinner.username',
  published: 'created_at',
  postId: 'id',
  postUrl: { template: 'https://www.pinterest.com/pin/{id}/', values: { id: 'id' } },
};

/*
 * One Behance project, wherever it is found. The cover is the only media the
 * feed carries; a project's own images arrive on its page, which is not mapped.
 *
 * The URL ends in .jpg even though the path says webp and the payload says
 * WEBP, so nothing is asserted and the extension does the classifying.
 */
const BEHANCE_PROJECT: MediaSpec = {
  url: 'covers.allAvailable[0].url',
  caption: 'name',
  author: 'owners[0].username',
  published: 'publishedOn',
  /* The permalink already carries the id, and Behance's own id is a number
     rather than the string every other platform uses. */
  postUrl: { template: '{url}', values: { url: 'url' } },
};

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
    apiPaths: ['/api/', '/graphql', '/discover/'],
    rules: instagramRules,
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
    id: 'behance',
    name: 'Behance',
    hosts: ['behance.net'],
    apiPaths: ['/v3/graphql'],
    /*
     * Behance serves everything, feed and search alike, through one
     * `/v3/graphql` endpoint. A project arrives under one of two roots and
     * keeps the same fields either way, so only the path differs.
     *
     * `covers.allAvailable` holds fourteen renditions per project, from the
     * original down through 808, 404, 202, 230 and 115. The original is first
     * in 48 of 48 projects captured, which is what makes indexing `[0]` right
     * rather than lucky; a fixture pins it so a reshuffle fails a test instead
     * of quietly downgrading every download to 115 pixels wide.
     */
    rules: [
      { at: 'data.forYouFeed.nodes[].entity', media: BEHANCE_PROJECT },
      { at: 'data.search.nodes[]', media: BEHANCE_PROJECT },
    ],
  },

  {
    id: 'pinterest',
    name: 'Pinterest',
    hosts: ['pinterest.com', 'pinimg.com', 'pin.it'],
    apiPaths: ['/resource/'],
    /*
     * Pinterest serves its feeds through named `/resource/…/get/` endpoints
     * that all answer with `resource_response.data`. The shape of a pin is the
     * same on every one of them; only the path to it changes, so the home feed
     * and search differ by one segment.
     *
     * `images` holds six renditions, `orig` being the one worth saving. The
     * file name carries the extension, so nothing has to be asserted for the
     * URL to be classified.
     */
    rules: [
      {
        at: 'resource_response.data[]',
        media: PINTEREST_PIN,
      },
      {
        at: 'resource_response.data.results[]',
        media: PINTEREST_PIN,
      },
    ],
  },

  {
    id: 'bsky',
    name: 'Bluesky',
    hosts: ['bsky.app', 'bsky.social', 'api.bsky.app'],
    apiPaths: ['/xrpc/app.bsky.feed.'],
    /*
     * Bluesky sends every embed twice.
     *
     * `post.record.embed` is the ATProto record as it was written: a CID, a
     * mime type and a size, with no URL anywhere in it. `post.embed` is the
     * same embed resolved for display, and that is the one with the links.
     *
     * A getTimeline response of thirty posts, sixteen with images and six
     * with video, yields a row from every post that carries media.
     *
     * `post.embed.playlist` is the HLS playlist as a bare string rather than an
     * object, so the video rule reads the embed itself and takes `playlist` as
     * the url. Images sit one level deeper, with `fullsize` and `thumb` at the
     * top of each entry.
     */
    rules: [
      {
        at: 'feed[].post.embed.images[]',
        media: {
          url: 'fullsize',
          /*
           * cdn.bsky.app serves blobs from an extensionless path, so nothing
           * about the URL says what it is. Bluesky's fullsize rendition is
           * JPEG unless asked otherwise, and the rule has to say so or every
           * image is dropped for having no file name.
           */
          mime: { literal: 'image/jpeg' },
          thumbnail: 'thumb',
          alt: 'alt',
          caption: '^^record.text',
          author: '^^author.handle',
          published: '^^indexedAt',
          postId: { last: '^^uri' },
          postUrl: {
            template: 'https://bsky.app/profile/{handle}/post/{rkey}',
            values: { handle: '^^author.handle', rkey: { last: '^^uri' } },
          },
        },
      },
      {
        at: 'feed[].post.embed',
        media: {
          when: { path: 'playlist', exists: true },
          url: 'playlist',
          mime: { literal: 'application/vnd.apple.mpegurl' },
          thumbnail: 'thumbnail',
          caption: '^record.text',
          author: '^author.handle',
          published: '^indexedAt',
          postId: { last: '^uri' },
          postUrl: {
            template: 'https://bsky.app/profile/{handle}/post/{rkey}',
            values: { handle: '^author.handle', rkey: { last: '^uri' } },
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
  {
    /*
     * Adobe Fonts has no catalogue API that anyone may call. It renders the
     * whole family or collection into a script tag in the page instead, which
     * is why this one reads `embedded` rather than an API response.
     *
     * The file URL is not in the payload either. It is assembled from two ids:
     * the kit the font belongs to, and the "font variation descriptor" that
     * names the weight and style. Both come from different places depending on
     * whether the page is a family or a collection, hence two rules.
     */
    id: 'adobe-fonts',
    name: 'Adobe Fonts',
    hosts: ['fonts.adobe.com'],
    /* Only family pages. Claiming collections too would let one rule set read
       the other's payload whenever a marker happened to line up. */
    apiPaths: ['/fonts/'],
    embedded: { start: '{"family":{"slug":"', end: '</script>' },
    rules: [
      {
        at: 'family.fonts[]',
        media: {
          url: {
            template: ADOBE_FONT_URL,
            values: { kit: 'family.web_id', fvd: 'font.web.fvd' },
          },
          mime: { literal: 'font/woff2' },
          title: 'name',
          caption: 'preferred_family_name',
          /* The designer belongs to the family, one step out from the font. */
          author: '^designers[0].name',
          postId: 'family.slug',
          postUrl: {
            template: 'https://fonts.adobe.com/fonts/{slug}',
            values: { slug: 'family.slug' },
          },
        },
      },
    ],
  },

  {
    id: 'adobe-fonts-collections',
    name: 'Adobe Fonts collections',
    hosts: ['fonts.adobe.com'],
    apiPaths: ['/collections/'],
    embedded: { start: '{"fontpack":{"all_valid_slugs":', end: '</script>' },
    rules: [
      {
        at: 'fontpack.font_variations[]',
        media: {
          url: { template: ADOBE_FONT_URL, values: { kit: 'opaque_id', fvd: 'fvd' } },
          mime: { literal: 'font/woff2' },
          title: 'full_display_name',
          caption: 'family.name',
          /* One step out of the variation lands on the pack. */
          author: '^contributor_credit',
          postId: 'family.slug',
          postUrl: {
            template: 'https://fonts.adobe.com/fonts/{slug}',
            values: { slug: 'family.slug' },
          },
        },
      },
    ],
  },
];
