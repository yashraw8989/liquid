document.addEventListener('DOMContentLoaded', function() {
  // --- B2G1 Rule Enforcement ---
  async function removeProductFromCart(lineItemKey) {
    try {
      const response = await fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lineItemKey, quantity: 0 })
      });
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error removing product:', errorData);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error in removeProductFromCart:', error);
      return false;
    }
  }

  // Helper function for manual cart refresh (async version)
  async function manualCartRefresh() {
    console.log("Attempting manual cart refresh for B2G1.");
    // This assumes 'window.routes' is globally available.
    const routes = window.routes || { cart_url: '/cart' }; // Basic fallback

    function getB2G1SectionInnerHTML(html, selector) {
      try {
        const parsedDoc = new DOMParser().parseFromString(html, 'text/html');
        const element = parsedDoc.querySelector(selector);
        return element ? element.innerHTML : "";
      } catch (e) {
        console.error("Error parsing HTML for B2G1 section:", e);
        return "";
      }
    }

    const mainCartItemsElement = document.getElementById('main-cart-items');
    const cartIconBubbleElement = document.getElementById('cart-icon-bubble');

    try {
      if (mainCartItemsElement) {
        const mainCartSectionId = mainCartItemsElement.dataset.id || 'main-cart-items';
        const responseText = await fetch(`${routes.cart_url}?section_id=${mainCartSectionId}`).then(res => res.ok ? res.text() : Promise.reject(`Failed to fetch ${mainCartSectionId}`)).catch(e => {console.error(e); return null;});
        if (responseText) {
          // Common selectors for cart items content within its section
          const selectors = ['cart-items', '.js-contents', `#${mainCartSectionId}`];
          let sourceHtml = "";
          for (const sel of selectors) {
            sourceHtml = getB2G1SectionInnerHTML(responseText, sel);
            if (sourceHtml) break;
          }
          
          if (sourceHtml) {
            const targetElement = mainCartItemsElement.querySelector('.js-contents') || mainCartItemsElement.querySelector('cart-items') || mainCartItemsElement;
            targetElement.innerHTML = sourceHtml;
          } else {
            console.warn(`Could not find content for main-cart-items using selectors: ${selectors.join(', ')}`);
          }
        }
      }

      if (cartIconBubbleElement) {
        const responseText = await fetch(`${routes.cart_url}?section_id=cart-icon-bubble`).then(res => res.ok ? res.text() : Promise.reject('Failed to fetch cart-icon-bubble')).catch(e => {console.error(e); return null;});
        if (responseText) {
          const sourceHtml = getB2G1SectionInnerHTML(responseText, '.shopify-section'); // cart-icon-bubble is usually a .shopify-section
          if (sourceHtml) {
            cartIconBubbleElement.innerHTML = sourceHtml;
          } else {
            console.warn('Could not find content for cart-icon-bubble using selector: .shopify-section');
          }
        }
      }
    } catch (e) {
      console.error("Error during B2G1 manual cart refresh:", e);
      // Fallback to reload if manual refresh itself errors significantly,
      // though this should be a last resort.
      // location.reload(); 
    }
  }

  async function enforceB2g1Rules() {
    const cartItemsNodes = document.querySelectorAll('.color-info .cart-item');
    const skuMap = {};
    let productRemoved = false;
    let b2g1Active = false;

    // Check for Shopify PubSub
    const hasPubSub = window.Shopify && window.Shopify.theme && window.Shopify.theme.pubsub;
    const pubSubEvents = hasPubSub ? window.Shopify.theme.pubsub.PUB_SUB_EVENTS : null;
    const publishEvent = hasPubSub ? window.Shopify.theme.pubsub.publish : null;

    cartItemsNodes.forEach(item => {
      const sku = item.getAttribute('data-product-sku');
      const quantity = parseInt(item.getAttribute('data-product-quantity')) || 0;
      const type = item.getAttribute('data-product-type');
      const lineItemKey = item.getAttribute('data-line-item-key');
      
      if (!sku || !lineItemKey) return;

      if (!skuMap[sku]) {
        skuMap[sku] = { paidQuantity: 0, freeItems: [] };
      }

      if (type === 'free') {
        skuMap[sku].freeItems.push({ lineItemKey, quantity });
      } else {
        skuMap[sku].paidQuantity += quantity;
      }
    });

    for (const sku in skuMap) {
      const { paidQuantity, freeItems } = skuMap[sku];
      const freeQuantity = freeItems.reduce((sum, item) => sum + item.quantity, 0);
      const totalQuantity = paidQuantity + freeQuantity;

      if (freeItems.length > 0 && totalQuantity > 2) {
        for (const freeItem of freeItems) { // Ensure this loop is async
          const removed = await removeProductFromCart(freeItem.lineItemKey);
          if (removed) {
            productRemoved = true;
          }
        }
      }

      if (freeItems.length > 0 && totalQuantity <= 2) {
        b2g1Active = true; // Mark B2G1 as active if any SKU qualifies
      }
    }

    if (b2g1Active) {
      sessionStorage.setItem('b2g1Active', 'true');
    } else {
      sessionStorage.removeItem('b2g1Active');
    }

    if (productRemoved) {
      sessionStorage.setItem('showPopup', 'true');
      // location.reload(); // Removed page reload

      if (hasPubSub && pubSubEvents && publishEvent) {
        console.log("B2G1: Product removed, attempting update via PubSub.");
        try {
          const cartState = await fetch('/cart.js').then(res => res.ok ? res.json() : Promise.reject("Failed to fetch cart state for PubSub")).catch(e => {console.error(e); return null;});
          if (cartState) {
            publishEvent(pubSubEvents.cartUpdate, { source: 'b2g1-rules', cartData: cartState });
            // Delay progress bar update slightly to allow DOM changes by subscribers
            setTimeout(() => updateProgressBar(), 500);
          } else {
            // Fallback if cart state fetch fails
            console.warn("B2G1: PubSub selected, but cart state fetch failed. Falling back to manual refresh.");
            await manualCartRefresh();
            updateProgressBar();
          }
        } catch (e) {
          console.error("B2G1: Error publishing cartUpdate event or fetching cart state:", e);
          await manualCartRefresh(); // Fallback to manual refresh
          updateProgressBar();
        }
      } else {
        console.log("B2G1: Product removed, Shopify PubSub not available. Attempting manual cart refresh.");
        await manualCartRefresh();
        updateProgressBar();
      }
    }
  }

  // --- Progress Bar ---
  let progressBarClosed = false;
  let offerComplete = false;

  const closeProgressBtn = document.querySelector('.close-progress');
  if (closeProgressBtn) {
    closeProgressBtn.addEventListener('click', function() {
      const progressContainer = document.querySelector('.b2g1-progress');
      if (progressContainer) {
        progressContainer.style.display = 'none';
        progressBarClosed = true;
      }
    });
  }

  function updateProgressBar() {
    if (progressBarClosed) {
      return;
    }

    fetch('/cart.js')
      .then(response => response.json())
      .then(cart => {
        const allItems = Array.from(document.querySelectorAll('.cart-item'));
        const b2g1Items = allItems.filter(item => {
          const attr = item.getAttribute('data-b2g1');
          return attr && attr.trim() === "true";
        });

        const progressContainer = document.querySelector('.b2g1-progress');
        const freebieModal = document.getElementById('gift-selection-modal');

        let modalDisplay = 'none';
        if (freebieModal) {
          modalDisplay = window.getComputedStyle(freebieModal).getPropertyValue('display');
        }

        if (freebieModal && modalDisplay !== 'none') {
          progressContainer.style.setProperty('display', 'none', 'important');
          return;
        }

        if (b2g1Items.length === 0) {
          progressContainer.style.setProperty('display', 'none', 'important');
          return;
        } else {
          progressContainer.style.setProperty('display', 'block', 'important');
        }

        let qualifyingCount = 0;
        b2g1Items.forEach(item => {
          qualifyingCount += parseInt(item.getAttribute('data-product-quantity')) || 0;
        });

        const displayedCount = Math.min(qualifyingCount, 3);

        const progressBar = document.querySelector('.progress-bar');
        const itemCount = document.querySelector('.item-count');
        const message = document.querySelector('.progress-message');

        let percent = Math.min((displayedCount / 3) * 100, 100);
        progressBar.style.width = percent + "%";
        itemCount.textContent = `${displayedCount}/3 items`;

        if (displayedCount < 3) {
          const remainingItems = 3 - displayedCount;
          const itemText = remainingItems === 1 ? 'item' : 'items';
          message.innerHTML = `You're almost there! Add ${remainingItems} more ${itemText} from this <a href="https://ebodycare.in/collections/buy-2-get-1-free">page</a> to avail this offer.`;
          progressBar.classList.remove('complete');
        } else {
          message.textContent = "You have availed the Buy 2 Get 1 offer!";
          progressBar.classList.add('complete');
          if (!offerComplete) {
            popConfetti();
            offerComplete = true;
          }
        }
      })
      .catch(error => console.error("Error fetching cart data:", error));
  }

  function popConfetti() {
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.9 }
    });
  }

  // Initialize B2G1 functions
  enforceB2g1Rules();
  updateProgressBar();
  setInterval(updateProgressBar, 5000);

  // Optional: Add listeners for quantity changes to reload page after update.
  document.querySelectorAll('.quantity__button, .quantity__input').forEach(element => {
    const eventType = element.tagName === 'INPUT' ? 'change' : 'click';
    element.addEventListener(eventType, function() {
      setTimeout(() => location.reload(), 1000);
    });
  });
});
