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

  async function enforceB2g1Rules() {
    const cartItems = document.querySelectorAll('.color-info .cart-item');
    const skuMap = {};
    let productRemoved = false;
    let b2g1Active = false;

    cartItems.forEach(item => {
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
        for (const freeItem of freeItems) {
          const removed = await removeProductFromCart(freeItem.lineItemKey);
          if (removed) {
            productRemoved = true;
          }
        }
      }

      if (freeItems.length > 0 && totalQuantity <= 2) {
        b2g1Active = true;
      }
    }

    if (b2g1Active) {
      sessionStorage.setItem('b2g1Active', 'true');
    } else {
      sessionStorage.removeItem('b2g1Active');
    }

    if (productRemoved) {
      sessionStorage.setItem('showPopup', 'true');
      location.reload();
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
