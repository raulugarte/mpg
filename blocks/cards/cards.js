import { createOptimizedPicture } from '../../scripts/aem.js';
import { moveInstrumentation } from '../../scripts/scripts.js';

export default function decorate(block) {
  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');

    // Config cells by position:
    // index 2 = Background Color, index 3 = CTA Style, index 4 = Style
    const bgValue = row.children[2]?.querySelector('p')?.textContent?.trim() || '';
    const ctaStyle = row.children[3]?.querySelector('p')?.textContent?.trim() || 'default';
    const styleValue = row.children[4]?.querySelector('p')?.textContent?.trim() || '';

    // Background color and layout style both become classes on the <li>
    if (bgValue && bgValue !== 'default') li.classList.add(bgValue);
    if (styleValue && styleValue !== 'default') li.classList.add(styleValue);

    moveInstrumentation(row, li);
    while (row.firstElementChild) li.append(row.firstElementChild);

    // Assign classes; hide the three config cells (index 2, 3, 4)
    [...li.children].forEach((div, index) => {
      if (index === 0) {
        div.className = 'cards-card-image';
      } else if (index === 1) {
        div.className = 'cards-card-body';
      } else if (index === 2 || index === 3 || index === 4) {
        div.className = 'cards-config';
        const p = div.querySelector('p');
        if (p) p.style.display = 'none';
      } else {
        div.className = 'cards-card-body';
      }
    });

    // Apply CTA style to button containers
    const buttonContainers = li.querySelectorAll('p.button-container');
    buttonContainers.forEach((buttonContainer) => {
      buttonContainer.classList.remove('default', 'cta-link', 'cta-button', 'cta-button-secondary', 'cta-button-dark', 'cta-default');
      buttonContainer.classList.add(ctaStyle);
    });

    ul.append(li);
  });

  ul.querySelectorAll('picture > img').forEach((img) => {
    const optimizedPic = createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]);
    moveInstrumentation(img, optimizedPic.querySelector('img'));
    img.closest('picture').replaceWith(optimizedPic);
  });

  block.textContent = '';
  block.append(ul);
}