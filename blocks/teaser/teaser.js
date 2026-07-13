import {
  div, a, span, img, video, source, button,
  h2,
} from '../../scripts/dom-helpers.js';
import { readBlockConfig } from '../../scripts/aem.js';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function getProp(properties, ...keys) {
  return keys
    .map((key) => properties?.[key])
    .find((value) => value !== undefined && value !== null && value !== '');
}

function createVideoPlayer(videoSrc) {
  const pauseIcon = `${window.hlx.codeBasePath}/icons/video-pause.svg`;
  const playIcon = `${window.hlx.codeBasePath}/icons/video-play.svg`;

  /* eslint-disable function-paren-newline */
  const videoPlayer = div({ class: 'video-container' },
    div({ class: 'video-play', id: 'playButton', tabindex: 0 },
      button({ class: 'video-play-btn', 'aria-label': 'video-play-btn' }, img({
        class: 'play-icon controls', src: playIcon, width: 28, height: 28, alt: 'play animation',
      })),
    ),
    div({ class: 'video-pause inactive', id: 'pauseButton' },
      button({ class: 'video-pause-btn', 'aria-label': 'video-pause-btn' }, img({
        class: 'pause-icon controls', src: pauseIcon, width: 28, height: 28, alt: 'pause animation',
      })),
    ),
    video({ id: 'videoPlayer', playsinline: true, muted: true, loop: true },
      source({ src: videoSrc, type: 'video/mp4' }, 'Your browser does not support the video tag.'),
    ),
  );

  return videoPlayer;
}

function createBackgroundImage(properties) {
  const imgSrc = getProp(properties, 'imageref', 'imageRef') || '';
  const imgAlt = getProp(properties, 'imagealt', 'alt') || '';

  const imgBackground = div({ class: 'background-image' },
    img({
      class: 'teaser-background',
      src: imgSrc,
      alt: imgAlt,
      loading: 'eager',
      decoding: 'async',
      fetchpriority: 'high',
    }),
  );

  if (!imgSrc) imgBackground.classList.add('inactive');

  return imgBackground;
}

function observeVideo(block, autoplay) {
  const videoPlayerEl = block.querySelector('video');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        if (!prefersReducedMotion.matches && autoplay && (videoPlayerEl.dataset.state !== 'pause')) {
          const playButton = document.getElementById('playButton');
          const pauseButton = document.getElementById('pauseButton');
          playButton.classList.add('inactive');
          playButton.removeAttribute('tabindex');
          pauseButton.classList.remove('inactive');
          pauseButton.setAttribute('tabindex', 0);
          videoPlayerEl.play();
        }
      } else {
        videoPlayerEl.pause();
      }
    });
  }, { threshold: 0.5 });

  observer.observe(videoPlayerEl);
}

function attachListeners() {
  const videoPlayer = document.getElementById('videoPlayer');
  const playButton = document.getElementById('playButton');
  const pauseButton = document.getElementById('pauseButton');

  ['click', 'keydown'].forEach((eventType) => {
    playButton.addEventListener(eventType, (event) => {
      if (eventType === 'keydown' && event.key !== 'Enter') return;
      playButton.classList.add('inactive');
      playButton.removeAttribute('tabindex');
      pauseButton.classList.remove('inactive');
      pauseButton.setAttribute('tabindex', 0);
      videoPlayer.autoplay = true;
      videoPlayer.dataset.state = 'play';
      videoPlayer.play();
    });
  });

  ['click', 'keydown'].forEach((eventType) => {
    pauseButton.addEventListener(eventType, (event) => {
      if (eventType === 'keydown' && event.key !== 'Enter') return;
      playButton.classList.remove('inactive');
      playButton.setAttribute('tabindex', 0);
      pauseButton.classList.add('inactive');
      pauseButton.removeAttribute('tabindex');
      videoPlayer.autoplay = false;
      videoPlayer.dataset.state = 'pause';
      videoPlayer.pause();
    });
  });
}

export default function decorate(block) {
  const properties = readBlockConfig(block);

  const teaserStyle = getProp(properties, 'teaserstyle', 'teaserStyle') || 'image';
  const isVideo = teaserStyle === 'video';
  const videoAutoplay = (getProp(properties, 'videobehavior', 'videoBehavior') || 'autoplay') === 'autoplay';

  const buttonText = getProp(properties, 'buttontext', 'buttonText') || 'Button';
  const buttonLink = getProp(properties, 'btn-link', 'btnLink') || '#';
  const buttonStyle = getProp(properties, 'ctastyle', 'ctaStyle') || 'button';

  const useSwooshRaw = getProp(properties, 'useswoosh', 'useSwoosh');
  const useSwoosh = String(useSwooshRaw) !== 'false';

  const swooshbgClass = useSwoosh ? 'swoosh-bg' : 'swoosh-bg-hidden';
  const swooshlayersClass = useSwoosh ? 'swoosh-layers' : 'swoosh-layers-hidden';

  const swooshFirst = `${window.hlx.codeBasePath}/icons/teaser_innerswoosh.svg`;
  const swooshSecond = `${window.hlx.codeBasePath}/icons/teaser_outerswoosh.svg`;

  const titleText = getProp(properties, 'title') || 'Title';

  const sampleVideo = 'https://v.ftcdn.net/02/35/97/40/700_F_235974059_oVftmgBBJ32tgsDvxRdMdtpQDMfNFWEt_ST.mp4';
  const videoReference = getProp(properties, 'videoreference', 'videoReference') || sampleVideo;

  const teaser = div({ class: 'teaser-container' },
    isVideo ? createVideoPlayer(videoReference) : createBackgroundImage(properties),
    div({ class: 'teaser-swoosh-wrapper' },
      div({ class: swooshbgClass }),
      div({ class: swooshlayersClass },
        img({ class: 'swoosh first', src: swooshFirst, alt: 'background swoosh first' }),
        img({ class: 'swoosh second', src: swooshSecond, alt: 'background swoosh second' }),
      ),
      div({ class: 'teaser-title-wrapper' },
        h2({ class: 'teaser-title' }, titleText),
        div({ class: `cta-${buttonStyle}` },
          a({ id: 'button', href: buttonLink, class: `button ${buttonStyle}` },
            span({ class: 'button-text' }, buttonText),
          ),
        ),
      ),
    ),
  );

  block.innerHTML = '';
  block.appendChild(teaser);

  if (isVideo) observeVideo(block, videoAutoplay);
  if (isVideo) attachListeners();
}