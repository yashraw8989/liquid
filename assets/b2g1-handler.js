/**
 * b2g1-handler.js
 *
 * Handles cart item quantity changes and removals using AJAX,
 * then triggers B2G1 rule evaluation and UI updates, including auto-adding free items.
 * Uses Shopify Section Rendering API for cart and footer updates.
 */

// Debounce function
function debounce(func, wait, immediate) {
  let timeout;
  return function executedFunction(...args) {
    const context = this;
    const later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

// --- AJAX Functions ---
async function _AJAX_updateCartItemQuantity(key, quantity) {
  console.log(`AJAX: Updating item ${key} to quantity ${quantity}`);
  try {
    const response = await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ id: key, quantity: quantity })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error('Error updating cart item quantity:', errorData);
      throw new Error(`Failed to update quantity: ${errorData.description || errorData.message || response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Fetch error in _AJAX_updateCartItemQuantity:', error);
    throw error;
  }
}

async function _AJAX_removeItemFromCart(key) {
  console.log(`AJAX: Removing item ${key}`);
  return _AJAX_updateCartItemQuantity(key, 0);
}

async function _AJAX_addItemToCart(variantId, quantity, properties) {
  console.log(`AJAX: Adding item variant ${variantId}, quantity ${quantity}, properties:`, properties);
  try {
    const response = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ items: [{ id: variantId, quantity: quantity, properties: properties }] })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error('Error adding item to cart:', errorData);
      throw new Error(`Failed to add item: ${errorData.description || errorData.message || response.statusText}`);
    }
    // The response from /cart/add.js is the item data, not the full cart.
    // We will fetch the full cart state after this in _PROMISE_applyB2G1Changes or similar.
    return await response.json(); 
  } catch (error) {
    console.error('Fetch error in _AJAX_addItemToCart:', error);
    throw error;
  }
}


// --- B2G1 Logic and UI Update Functions ---
async function _PROMISE_evaluateB2G1(updatedCart) {
  console.log('B2G1: Evaluating rules for cart:', updatedCart);
  const actionsNeeded = [];
  let b2g1Active = false;

  if (!updatedCart || !updatedCart.items) {
    sessionStorage.removeItem('b2g1Active');
    return { b2g1Status: "cart_empty_or_invalid", actionsNeeded, b2g1Active };
  }
   if (updatedCart.items.length === 0) {
     sessionStorage.removeItem('b2g1Active');
     return { b2g1Status: "cart_empty", actionsNeeded, b2g1Active };
  }

  const skuMap = {};
  const B2G1_ELIGIBILITY_TAG = 'buy 2 get 1 free';

  for (const item of updatedCart.items) {
    let itemTags = [];
    if (typeof item.tags === 'string') itemTags = item.tags.split(',').map(t => t.trim().toLowerCase());
    else if (Array.isArray(item.tags)) itemTags = item.tags.map(t => t.toLowerCase());
    
    const productTitleLower = (item.product_title || '').toLowerCase();
    const isB2G1EligibleProduct = itemTags.includes(B2G1_ELIGIBILITY_TAG) || productTitleLower.includes('[b2g1]');

    if (!isB2G1EligibleProduct) continue;
    const sku = item.sku;
    if (!sku) continue;

    if (!skuMap[sku]) {
      skuMap[sku] = { paidQuantity: 0, freeItems: [], totalQuantity: 0, variantId: item.variant_id, originalPrice: item.original_price };
    }
    
    const isTrulyFreeItem = (item.properties && item.properties._b2g1_free_item === 'true') || 
                             (item.final_line_price === 0 && item.original_line_price > 0 && item.total_discount > 0);

    if (isTrulyFreeItem) skuMap[sku].freeItems.push({ key: item.key, quantity: item.quantity });
    else skuMap[sku].paidQuantity += item.quantity;
    skuMap[sku].totalQuantity += item.quantity;
  }

  for (const sku in skuMap) {
    const data = skuMap[sku];
    const totalPaidQuantityInSku = data.paidQuantity;
    const expectedMaxFreeItems = Math.floor(totalPaidQuantityInSku / 2);
    let currentFreeItemQuantityInCart = data.freeItems.reduce((sum, fi) => sum + fi.quantity, 0);

    if (currentFreeItemQuantityInCart > expectedMaxFreeItems) {
      let excessFreeItems = currentFreeItemQuantityInCart - expectedMaxFreeItems;
      for (let i = data.freeItems.length - 1; i >= 0 && excessFreeItems > 0; i--) {
        const freeItemLine = data.freeItems[i];
        const quantityToRemoveFromThisLine = Math.min(freeItemLine.quantity, excessFreeItems);
        actionsNeeded.push({ action: 'update', key: freeItemLine.key, newQuantity: freeItemLine.quantity - quantityToRemoveFromThisLine, reason: `B2G1_violation_SKU_${sku}_excess_free_item`});
        excessFreeItems -= quantityToRemoveFromThisLine;
      }
    } else if (currentFreeItemQuantityInCart < expectedMaxFreeItems) {
      let itemsToAdd = expectedMaxFreeItems - currentFreeItemQuantityInCart;
      for (let i = 0; i < itemsToAdd; i++) {
        actionsNeeded.push({ action: 'add', variantId: data.variantId, quantity: 1, properties: { '_b2g1_free_item': 'true', 'Original Price': Shopify.formatMoney(data.originalPrice)}, reason: `B2G1_entitled_free_item_SKU_${sku}`});
      }
    }
    // Recalculate currentFreeItemQuantityInCart based on actions to determine b2g1Active status accurately for this SKU
    let projectedFreeItemQty = currentFreeItemQuantityInCart;
    actionsNeeded.forEach(action => {
        if(action.action === 'add' && action.variantId === data.variantId) projectedFreeItemQty += action.quantity;
        if(action.action === 'update' && data.freeItems.some(fi => fi.key === action.key)) {
            const originalItem = data.freeItems.find(fi => fi.key === action.key);
            projectedFreeItemQty -= (originalItem.quantity - action.newQuantity);
        }
    });

    if (projectedFreeItemQty > 0 && projectedFreeItemQty <= Math.floor(totalPaidQuantityInSku / 2) && totalPaidQuantityInSku >= 2) {
      b2g1Active = true;
    }
  }
  
  console.log('B2G1: Evaluation complete. Actions needed:', actionsNeeded, "b2g1Active:", b2g1Active);
  return { b2g1Status: "evaluation_complete", actionsNeeded, b2g1Active };
}

async function _PROMISE_applyB2G1Changes(b2g1EvalResult, currentCart) {
  console.log('B2G1: Applying changes based on eval result:', b2g1EvalResult, 'and current cart:', currentCart);
  let cartAfterB2G1Changes = currentCart;
  let itemRemovedDueToB2G1 = false;
  let requiresCartRefetch = false;

  if (b2g1EvalResult.actionsNeeded && b2g1EvalResult.actionsNeeded.length > 0) {
    requiresCartRefetch = true; // Assume refetch is needed if any action is taken
    for (const action of b2g1EvalResult.actionsNeeded) {
      if (action.action === 'update') {
        await _AJAX_updateCartItemQuantity(action.key, action.newQuantity); // Don't assign to cartAfterB2G1Changes here
        if (action.newQuantity === 0) itemRemovedDueToB2G1 = true;
        console.log(`B2G1: Applied action - updated item ${action.key} to quantity ${action.newQuantity}. Reason: ${action.reason}`);
      } else if (action.action === 'add') {
        await _AJAX_addItemToCart(action.variantId, action.quantity, action.properties);
        console.log(`B2G1: Applied action - added item variant ${action.variantId}, quantity ${action.quantity}. Reason: ${action.reason}`);
      }
    }
    if (requiresCartRefetch) { 
        console.log('B2G1: Fetching final cart state after B2G1 modifications.');
        cartAfterB2G1Changes = await fetch('/cart.js').then(res => res.json()).catch(e => {
            console.error("B2G1: Error fetching final cart state after B2G1 changes", e);
            return cartAfterB2G1Changes; 
        });
    }
  }
  
  if (itemRemovedDueToB2G1) sessionStorage.setItem('showPopup', 'true');
  if (b2g1EvalResult.b2g1Active) sessionStorage.setItem('b2g1Active', 'true');
  else sessionStorage.removeItem('b2g1Active');

  return cartAfterB2G1Changes;
}

function popConfetti() {
  if (typeof confetti === 'function') confetti({ particleCount: 150, spread: 70, origin: { y: 0.9 } });
  else console.warn('Confetti function not found. Ensure canvas-confetti script is loaded.');
}

async function _fetchSectionHtml(sectionId) {
  try {
    const response = await fetch(`/cart?section_id=${sectionId}`);
    if (!response.ok) throw new Error(`Failed to fetch section: ${sectionId}`);
    return await response.text();
  } catch (error) {
    console.error(`Error fetching section ${sectionId}:`, error);
    return null;
  }
}

function _updateSectionDOM(sectionId, html) {
    const newDocument = new DOMParser().parseFromString(html, 'text/html');
    const newElement = newDocument.getElementById(`shopify-section-${sectionId}`); // Standard Shopify section wrapper ID
    const oldElement = document.getElementById(`shopify-section-${sectionId}`);

    if (newElement && oldElement) {
        oldElement.innerHTML = newElement.innerHTML;
        console.log(`UI: Section ${sectionId} updated via Section Rendering API.`);
    } else {
        console.warn(`UI: Could not find new or old element for section_id: ${sectionId} to update via Section API.`);
    }
}


async function _PROMISE_updateUI(finalCartState) {
  console.log('UI: Updating with final cart state:', finalCartState);

  // Section IDs from templates/cart.json
  const mainCartItemsSectionId = 'main-cart-items'; 
  const mainCartFooterSectionId = 'main-cart-footer';

  // Fetch and update main cart items and footer sections
  const [cartItemsHtml, cartFooterHtml] = await Promise.all([
    _fetchSectionHtml(mainCartItemsSectionId),
    _fetchSectionHtml(mainCartFooterSectionId)
  ]);

  if (cartItemsHtml) _updateSectionDOM(mainCartItemsSectionId, cartItemsHtml);
  if (cartFooterHtml) _updateSectionDOM(mainCartFooterSectionId, cartFooterHtml);

  // Update Cart Drawer if it's present and visible (more complex, as it's not a standard section)
  // For now, we rely on the 'cart:updated' event for the drawer to refresh itself if it has its own listeners.
  // A more direct update would involve selecting its specific content elements and re-rendering.
  const cartDrawerElement = document.querySelector('cart-drawer');
  if (cartDrawerElement && cartDrawerElement.classList.contains('active')) {
      // Potentially trigger a refresh method on the cart-drawer custom element if it exists
      // Or, if cart-drawer listens to 'cart:updated', it might refresh itself.
      console.log("UI: Cart drawer is active, relying on 'cart:updated' event for its refresh or manual refresh needed.");
  }


  // Update B2G1 Progress Bar (manual DOM update, as it's a smaller, specific element)
  const b2g1ProgressBar = document.querySelector('.b2g1-progress .progress-bar');
  const b2g1ItemCountText = document.querySelector('.b2g1-progress .item-count');
  const b2g1MessageText = document.querySelector('.b2g1-progress .progress-message');
  const b2g1ProgressContainer = document.querySelector('.b2g1-progress');

  if (b2g1ProgressContainer) {
    let b2g1EligibleCount = 0;
    let isB2G1ProductInCart = false;
    const B2G1_ELIGIBILITY_TAG = 'buy 2 get 1 free';

    finalCartState.items.forEach(item => {
      let itemTags = [];
      if (typeof item.tags === 'string') itemTags = item.tags.split(',').map(t => t.trim().toLowerCase());
      else if (Array.isArray(item.tags)) itemTags = item.tags.map(t => t.toLowerCase());
      const productTitleLower = (item.product_title || '').toLowerCase();
      const isEligible = itemTags.includes(B2G1_ELIGIBILITY_TAG) || productTitleLower.includes('[b2g1]');

      if (isEligible) {
        isB2G1ProductInCart = true;
        if (item.final_line_price > 0 || (item.original_line_price === 0 && item.line_price === 0 && (!item.properties || item.properties._isB2G1FreeItem !== 'true'))) {
           b2g1EligibleCount += item.quantity;
        }
      }
    });

    const displayedCount = Math.min(b2g1EligibleCount, 3);
    const percent = isB2G1ProductInCart ? Math.min((displayedCount / 3) * 100, 100) : 0;
    
    if (b2g1ProgressBar) b2g1ProgressBar.style.width = `${percent}%`;
    if (b2g1ItemCountText) b2g1ItemCountText.textContent = `${displayedCount}/3 items`;

    const b2g1IsActiveFromStorage = sessionStorage.getItem('b2g1Active') === 'true';
    const hasZeroPriceB2G1Item = finalCartState.items.some(item => {
        let itemTags = [];
        if (typeof item.tags === 'string') itemTags = item.tags.split(',').map(t => t.trim().toLowerCase());
        else if (Array.isArray(item.tags)) itemTags = item.tags.map(t => t.toLowerCase());
        const productTitleLower = (item.product_title || '').toLowerCase();
        const isEligible = itemTags.includes(B2G1_ELIGIBILITY_TAG) || productTitleLower.includes('[b2g1]');
        return item.final_line_price === 0 && isEligible;
    });
    const freebieModalActive = document.getElementById('gift-selection-modal')?.style.display !== 'none';

    if (b2g1IsActiveFromStorage && isB2G1ProductInCart && !hasZeroPriceB2G1Item && !freebieModalActive) {
        b2g1ProgressContainer.style.display = 'block';
        if (displayedCount < 3) {
            const remainingItems = 3 - displayedCount;
            const itemText = remainingItems === 1 ? 'item' : 'items';
            if(b2g1MessageText) b2g1MessageText.innerHTML = `You're almost there! Add ${remainingItems} more ${itemText} from the <a href="/collections/buy-2-get-1-free" style="color:red;">B2G1 collection</a>.`;
            if(b2g1ProgressBar) b2g1ProgressBar.classList.remove('complete');
        } else {
            if(b2g1MessageText) b2g1MessageText.textContent = "You have availed the Buy 2 Get 1 offer!";
            if(b2g1ProgressBar) b2g1ProgressBar.classList.add('complete');
            if (typeof popConfetti === 'function' && !b2g1ProgressContainer.dataset.confettiPopped) { 
                popConfetti();
                b2g1ProgressContainer.dataset.confettiPopped = 'true';
            }
        }
    } else {
        b2g1ProgressContainer.style.display = 'none';
        delete b2g1ProgressContainer.dataset.confettiPopped;
    }
  }

  // Update general cart state classes (e.g., for empty cart message)
  const isEmpty = finalCartState.item_count === 0;
  document.querySelector('cart-items')?.classList.toggle('is-empty', isEmpty);
  document.querySelector('cart-drawer')?.classList.toggle('is-empty', isEmpty);
  document.querySelector('#cart')?.classList.toggle('is-empty', isEmpty);


  const checkoutButtons = document.querySelectorAll('button[name="checkout"], #CartDrawer-Checkout');
  checkoutButtons.forEach(btn => btn.disabled = isEmpty);
  
  document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true, detail: { cart: finalCartState } }));
  await _handleFreeGiftEligibility(finalCartState); // Call free gift eligibility check

  console.log("UI update processing finished.");
}


// --- Event Handlers ---
async function handleQuantityInputChange(event) {
  const input = event.target;
  const cartItemElement = input.closest('.cart-item'); 
  const lineItemKey = cartItemElement?.dataset.lineItemKey;
  const newQuantity = parseInt(input.value, 10);

  if (!lineItemKey) {
    console.error('Line item key not found for input change. Input ID:', input.id, 'Cart Item Element:', cartItemElement);
    return;
  }
  if (isNaN(newQuantity) || newQuantity < 0) {
    console.error('Invalid quantity for input change.');
    return;
  }

  input.disabled = true;
  try {
    const updatedCart = await _AJAX_updateCartItemQuantity(lineItemKey, newQuantity);
    const b2g1Status = await _PROMISE_evaluateB2G1(updatedCart);
    const finalCartState = await _PROMISE_applyB2G1Changes(b2g1Status, updatedCart);
    await _PROMISE_updateUI(finalCartState);
  } catch (error) {
    console.error('Error processing quantity input change:', error);
  } finally {
     if (input) input.disabled = false; // Re-enable specifically, _PROMISE_updateUI re-renders whole sections
  }
}

async function handleQuantityButtonClick(event) {
  const button = event.target.closest('.quantity__button');
  if (!button) return;
  event.preventDefault();

  const cartItemElement = button.closest('.cart-item'); 
  const lineItemKey = cartItemElement?.dataset.lineItemKey;
  const quantityInputElement = button.closest('quantity-input')?.querySelector('.quantity__input');

  if (!quantityInputElement) {
      console.error('Quantity input not found for button click.');
      return;
  }
  if (!lineItemKey) {
    console.error('Line item key not found for button click. Button:', button, 'Cart Item Element:', cartItemElement);
    return;
  }

  const action = button.name; 
  let currentQuantity = parseInt(quantityInputElement.value, 10);
  let newQuantity = currentQuantity;
  const step = parseInt(quantityInputElement.step) || 1;
  const min = parseInt(quantityInputElement.min) || 0;

  if (action === 'plus') newQuantity = currentQuantity + step;
  else if (action === 'minus') newQuantity = currentQuantity - step;
  if (newQuantity < min) newQuantity = min;

  if (newQuantity === currentQuantity && !(action === 'minus' && newQuantity === 0 && currentQuantity > 0) ) {
     return;
  }

  button.disabled = true;
  quantityInputElement.disabled = true;
  try {
    const updatedCart = await _AJAX_updateCartItemQuantity(lineItemKey, newQuantity);
    const b2g1Status = await _PROMISE_evaluateB2G1(updatedCart);
    const finalCartState = await _PROMISE_applyB2G1Changes(b2g1Status, updatedCart);
    await _PROMISE_updateUI(finalCartState);
  } catch (error) {
    console.error('Error processing quantity button click:', error);
  } finally {
    // Re-enable buttons after UI update. Section rendering will recreate them.
    // If not using section rendering for these specific buttons, enable them here.
  }
}

async function handleRemoveItemClick(event) {
  const removeButtonParent = event.target.closest('cart-remove-button');
  if (!removeButtonParent) return;
  event.preventDefault();

  const cartItemElement = removeButtonParent.closest('.cart-item'); 
  const lineItemKey = cartItemElement?.dataset.lineItemKey;
  const actualButton = removeButtonParent.querySelector('a, button');

  if (!lineItemKey) {
    console.error('Line item key not found for removal. Remove button parent:', removeButtonParent);
    return;
  }

  if (actualButton) {
    actualButton.style.pointerEvents = 'none'; 
    actualButton.disabled = true; 
  }
  try {
    const updatedCart = await _AJAX_removeItemFromCart(lineItemKey);
    const b2g1Status = await _PROMISE_evaluateB2G1(updatedCart);
    const finalCartState = await _PROMISE_applyB2G1Changes(b2g1Status, updatedCart);
    await _PROMISE_updateUI(finalCartState); 
  } catch (error) {
    console.error('Error processing item removal:', error);
    if (actualButton) { 
        actualButton.style.pointerEvents = '';
        actualButton.disabled = false;
    }
  }
}

// --- Initialization ---
function initializeCartEventHandlers() {
  const staticParent = document.body; 
  staticParent.addEventListener('click', function(event) {
    if (event.target.closest('.quantity__button')) handleQuantityButtonClick(event);
    else if (event.target.closest('cart-remove-button a') || event.target.closest('cart-remove-button > button.cart-remove-button')) handleRemoveItemClick(event);
  });

  const debouncedQuantityChange = debounce(handleQuantityInputChange, 350); 
  staticParent.addEventListener('change', function(event) {
    if (event.target.matches('.quantity__input')) {
      if (event.target.closest('#main-cart-items') || event.target.closest('#CartDrawer')) {
        debouncedQuantityChange(event);
      }
    }
  });
  console.log('B2G1/Cart event handlers initialized using event delegation on document.body.');
}

// --- Free Gift Modal Logic ---
const FREE_GIFT_PRODUCT_URLS = [
  '/products/bodyx-unisex-deodorant-xtacy-deo-150ml',
  '/products/bodyx-unisex-deodorant-xpression-deo-150ml'
];
const FREE_GIFT_THRESHOLD = 100000; 

async function _fetchProductJson(handle) {
  try {
    const response = await fetch(`/products/${handle}.json`);
    if (!response.ok) throw new Error(`Failed to fetch product: ${handle}`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching product JSON:', error);
    return null;
  }
}

async function _hasDuplicateColorInCart(cartItems, freeGiftColor) {
    const renderedCartItems = document.querySelectorAll('#main-cart-items .cart-item, #CartDrawer-CartItems .cart-item');
    for (const itemElement of renderedCartItems) {
        if (itemElement.dataset.productColor === freeGiftColor) return true;
    }
    return false;
}

// Modified: _AJAX_addFreeGiftToCart now part of the main AJAX flow
async function _AJAX_addAndProcessFreeGift(variantId, properties) {
    console.log(`AJAX: Adding free gift variant ${variantId} with properties:`, properties);
    try {
        await _AJAX_addItemToCart(variantId, 1, properties); // Use the existing generic add item
        // After adding, fetch the updated cart and run the full B2G1 + UI update cycle
        const updatedCart = await fetch('/cart.js').then(res => res.json());
        const b2g1Status = await _PROMISE_evaluateB2G1(updatedCart);
        const finalCartState = await _PROMISE_applyB2G1Changes(b2g1Status, updatedCart);
        await _PROMISE_updateUI(finalCartState);
        console.log('Free gift added and cart/UI updated.');
    } catch (error) {
        console.error('Error processing free gift addition:', error);
        // Optionally re-enable button or show error to user if needed
    }
}


async function _fetchProductDataAndUpdateGiftModal(productUrl, imgId, nameId, buttonId) {
  const productHandle = productUrl.replace("/products/", "");
  const productJson = await _fetchProductJson(productHandle); 
  if (productJson && productJson.product) {
    const product = productJson.product;
    const productImg = product.images && product.images.length > 0 ? product.images[0].src : 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png';
    const productName = product.title;
    const variantId = product.variants && product.variants.length > 0 ? product.variants[0].id : null;

    const imgElement = document.getElementById(imgId);
    const nameElement = document.getElementById(nameId);
    const buttonElement = document.getElementById(buttonId);

    if (imgElement) imgElement.src = productImg;
    if (nameElement) nameElement.innerText = productName;
    if (buttonElement && variantId) {
      buttonElement.onclick = async function () {
        buttonElement.disabled = true;
        try {
          await _AJAX_addAndProcessFreeGift(variantId, {'_free_gift_item': 'true'}); // Example property
          const modal = document.getElementById('gift-selection-modal');
          if (modal) modal.style.display = 'none';
        } catch(e) {
           console.error("Failed to add free gift from modal button:", e);
        } finally {
            if (buttonElement) buttonElement.disabled = false;
        }
      };
    } else if (buttonElement) {
        buttonElement.disabled = true; 
        console.warn(`No variant ID for gift button ${buttonId}`);
    }
  }
}

function _showFreeGiftModal() {
  const modal = document.getElementById('gift-selection-modal');
  if (!modal) {
    console.warn("Free gift modal structure not found in DOM.");
    return;
  }
  modal.style.display = 'block';
  _fetchProductDataAndUpdateGiftModal(FREE_GIFT_PRODUCT_URLS[0], 'gift1-img', 'gift1-name', 'gift1-btn');
  _fetchProductDataAndUpdateGiftModal(FREE_GIFT_PRODUCT_URLS[1], 'gift2-img', 'gift2-name', 'gift2-btn');
  const closeButton = modal.querySelector('.close-btn5'); 
  if (closeButton) closeButton.onclick = function() { modal.style.display = 'none'; };
}

async function _handleFreeGiftEligibility(cart) {
  console.log('FreeGift: Checking eligibility based on cart:', cart);
  if (sessionStorage.getItem('b2g1Active') === 'true') {
    console.log('FreeGift: B2G1 is active, skipping free gift modal.');
    return;
  }
  const hasExistingFreeGift = cart.items.some(item =>
    FREE_GIFT_PRODUCT_URLS.some(url => item.url && item.url.includes(url)) || (item.properties && item.properties._free_gift_item === 'true')
  );
  if (hasExistingFreeGift) {
    console.log('FreeGift: A free gift from the list/property is already in the cart.');
    return;
  }
  let totalEligiblePrice = 0;
  for (const item of cart.items) {
    const productTags = item.tags || []; 
    const isEligibleForFreebieTrigger = productTags.includes('freebie popup');
    if (isEligibleForFreebieTrigger) totalEligiblePrice += item.final_line_price; 
  }
  if (totalEligiblePrice >= FREE_GIFT_THRESHOLD) _showFreeGiftModal();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeCartEventHandlers);
else initializeCartEventHandlers();
