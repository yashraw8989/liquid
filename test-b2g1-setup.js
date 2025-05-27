document.addEventListener('DOMContentLoaded', function () {
    const consoleLogElement = document.getElementById('console-log');
    const cartItemsContainer = document.querySelector('#main-cart-items .color-info');

    function logToPage(message) {
        console.log(message); // Also log to browser console
        const currentLog = consoleLogElement.textContent;
        consoleLogElement.textContent = `${currentLog}\n[${new Date().toLocaleTimeString()}] ${message}`;
    }

    logToPage('Test environment initialized.');

    // --- Mocking Infrastructure ---
    let mockShopify = {
        theme: {
            pubsub: {
                PUB_SUB_EVENTS: {
                    cartUpdate: 'cart:update',
                },
                publish: function (event, data) {
                    logToPage(`Mock PubSub: Event '${event}' published with data: ${JSON.stringify(data)}`);
                    // Simulate cart items update based on published data
                    if (event === this.PUB_SUB_EVENTS.cartUpdate && data && data.cartData) {
                        mockCartState = data.cartData; // Update mock cart state
                        logToPage('Mock PubSub: Cart state updated from published data.');
                        // Simulate section updates that would normally happen in cart.js etc.
                        // For this test, we'll just log it and rely on manualCartRefresh logic for visuals if pubsub is off
                        if (document.getElementById('main-cart-items')) {
                             logToPage('Mock PubSub: Simulating update of main-cart-items section.');
                             const mainCartEl = document.getElementById('main-cart-items').querySelector('.js-contents');
                             if(mainCartEl) mainCartEl.innerHTML = `<p>Updated by PubSub. Items: ${mockCartState.item_count}</p>${renderMockCartItems(mockCartState.items)}`;
                        }
                        if (document.getElementById('cart-icon-bubble')) {
                            logToPage('Mock PubSub: Simulating update of cart-icon-bubble section.');
                             document.getElementById('cart-icon-bubble').innerHTML = `<div class="shopify-section">Bubble Updated by PubSub: ${mockCartState.item_count} items</div>`;
                        }
                    }
                }
            }
        }
    };
    let useMockPubSub = false; // Default to testing the fallback

    window.routes = {
        cart_url: '/cart', // Used by manualCartRefresh
        cart_change_url: '/cart/change.js', // Used by removeProductFromCart
        // cart_update_url: '/cart/update.js' // Not directly used by tested functions but good to have
    };

    let mockCartState = {
        item_count: 0,
        items: [],
        sections: {} // For section rendering mocks
    };

    const originalFetch = window.fetch;
    window.fetch = async function (url, options) {
        logToPage(`Mock Fetch: Intercepted ${options ? options.method || 'GET' : 'GET'} ${url}`);
        if (options && options.body) {
            try {
                logToPage(`Mock Fetch: Body: ${JSON.stringify(JSON.parse(options.body))}`);
            } catch (e) {
                logToPage(`Mock Fetch: Body: ${options.body}`);
            }
        }

        // --- /cart/change.js ---
        if (url.includes('/cart/change.js')) {
            const body = JSON.parse(options.body);
            const keyToRemove = body.id; // Assuming 'id' is the line_item_key
            let itemFound = false;
            mockCartState.items = mockCartState.items.filter(item => {
                if (item.key === keyToRemove) {
                    itemFound = true;
                    logToPage(`Mock Fetch (/cart/change.js): Removing item with key ${keyToRemove}`);
                    return false;
                }
                return true;
            });
            mockCartState.item_count = mockCartState.items.reduce((sum, item) => sum + item.quantity, 0);
            
            if (itemFound) {
                logToPage(`Mock Fetch (/cart/change.js): Item ${keyToRemove} removed. New count: ${mockCartState.item_count}`);
                 // b2g1.js expects a response that might contain sections, but primarily checks response.ok
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        // Shopify's actual response for a successful removal is the whole cart object
                        ...mockCartState
                    }),
                    text: () => Promise.resolve(JSON.stringify(mockCartState)) // if CartItems.js processes it as text
                });
            } else {
                logToPage(`Mock Fetch (/cart/change.js): Item ${keyToRemove} not found for removal.`);
                return Promise.resolve({
                    ok: false,
                    status: 404,
                    json: () => Promise.resolve({ description: 'Item not found' })
                });
            }
        }

        // --- /cart.js (for fetching cart state) ---
        if (url === '/cart.js' || url === routes.cart_url && !url.includes('section_id')) {
            logToPage(`Mock Fetch (/cart.js): Returning current mock cart state. Items: ${mockCartState.item_count}`);
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(JSON.parse(JSON.stringify(mockCartState))) // Deep copy
            });
        }

        // --- /cart?section_id=SECTION_NAME (for manualCartRefresh) ---
        if (url.includes('/cart?section_id=')) {
            const sectionId = new URLSearchParams(url.split('?')[1]).get('section_id');
            logToPage(`Mock Fetch (section_id): Requesting section ${sectionId}`);
            let sectionHtml = '';
            if (sectionId === 'main-cart-items' || sectionId === (document.getElementById('main-cart-items')?.dataset.id)) {
                sectionHtml = `<div id="main-cart-items" data-id="${sectionId}"><div class="js-contents"><p>Mock HTML for main-cart-items. Items: ${mockCartState.item_count}</p>${renderMockCartItems(mockCartState.items)}</div></div>`;
            } else if (sectionId === 'cart-icon-bubble') {
                sectionHtml = `<div id="cart-icon-bubble"><div class="shopify-section">Mock HTML for cart-icon-bubble. Items: ${mockCartState.item_count}</div></div>`;
            } else {
                sectionHtml = `<div class="shopify-section"><p>Mock HTML for unknown section ${sectionId}</p></div>`;
            }
            return Promise.resolve({
                ok: true,
                text: () => Promise.resolve(sectionHtml)
            });
        }

        logToPage(`Mock Fetch: No mock handler for ${url}, falling back to original fetch (if any, or error).`);
        return originalFetch ? originalFetch(url, options) : Promise.reject(new Error(`No mock handler and no original fetch for ${url}`));
    };

    // --- Cart Item Management ---
    function createCartItemElement(sku, quantity, type, key, b2g1 = "true") {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'cart-item'; // b2g1.js uses '.color-info .cart-item' but let's assume .cart-item is enough if placed correctly
        itemDiv.setAttribute('data-product-sku', sku);
        itemDiv.setAttribute('data-product-quantity', quantity.toString());
        itemDiv.setAttribute('data-product-type', type); // 'free' or 'paid' (or other)
        itemDiv.setAttribute('data-line-item-key', key);
        itemDiv.setAttribute('data-b2g1', b2g1); // For updateProgressBar
        itemDiv.innerHTML = `SKU: ${sku}, Qty: ${quantity}, Type: ${type}, Key: ${key.substring(0,5)}`;
        return itemDiv;
    }
    
    function renderMockCartItems(items) {
        let html = "<ul>";
        items.forEach(item => {
            html += `<li>SKU: ${item.sku}, Qty: ${item.quantity}, Type: ${item.properties._type || 'paid'}, Key: ${item.key.substring(0,5)}</li>`;
        });
        html += "</ul>";
        return html;
    }


    function addMockItemToCartDOM(itemData) {
         // Ensure properties exist for type checking
        if (!itemData.properties) itemData.properties = {};
        itemData.properties._type = itemData.properties._type || (itemData.type === 'free' ? 'free' : 'paid');

        const itemElement = createCartItemElement(
            itemData.sku,
            itemData.quantity,
            itemData.properties._type, // Use the _type from properties
            itemData.key,
            itemData.b2g1 === "true" ? "true" : "false"
        );
        cartItemsContainer.appendChild(itemElement);
        logToPage(`DOM: Added item ${itemData.key.substring(0,5)} to visual mock cart.`);
    }
    
    function findItemInMockCart(key) {
        return mockCartState.items.find(i => i.key === key);
    }

    function addOrUpdateMockItem(sku, quantity, type, key, b2g1 = "true") {
        let item = findItemInMockCart(key);
        if (item) {
            item.quantity = quantity;
            logToPage(`Mock Cart: Updated item ${key.substring(0,5)} quantity to ${quantity}.`);
        } else {
            item = {
                key: key,
                sku: sku, // SKU is not a standard Shopify cart item property, but used by b2g1.js via data attributes
                quantity: quantity,
                properties: { _type: type }, // Store 'free'/'paid' in properties like some apps do
                title: `Product ${sku}`,
                price: type === 'free' ? 0 : 2000, // $20.00
                line_price: type === 'free' ? 0 : 2000 * quantity,
                original_line_price: type === 'free' ? 0 : 2000 * quantity,
                b2g1: b2g1 // Custom flag for testing progress bar
            };
            mockCartState.items.push(item);
            logToPage(`Mock Cart: Added item ${key.substring(0,5)} (SKU: ${sku}, Qty: ${quantity}, Type: ${type}).`);
        }
        addMockItemToCartDOM(item); // Add/update in the simple DOM representation
        mockCartState.item_count = mockCartState.items.reduce((sum, i) => sum + i.quantity, 0);
        return item;
    }
    
    function clearCartDOM() {
        cartItemsContainer.innerHTML = '';
        logToPage('DOM: Cleared mock cart items from page.');
    }


    // --- Test Scenario Setup ---
    function setupInitialCartState() {
        clearCartDOM();
        mockCartState.items = [];
        mockCartState.item_count = 0;

        // Scenario: 2 Paid SKU A, 1 Free SKU A
        addOrUpdateMockItem('SKU_A', 2, 'paid', 'A1key');
        addOrUpdateMockItem('SKU_A', 1, 'free', 'A2key_free');
        logToPage('Setup: Initial cart state (2 Paid SKU_A, 1 Free SKU_A). Should be stable.');
        // Manually run enforceB2g1Rules to check initial stability (optional, or assume it's stable)
        // For testing, we'll trigger it after the *next* add.
    }
    
    document.getElementById('test1-setup').addEventListener('click', () => {
        logToPage('--- Test 1 Setup clicked ---');
        setupInitialCartState();
        // Call enforceB2g1Rules to ensure it's stable. No removal should happen.
        window.enforceB2g1Rules().then(() => {
            logToPage("Initial enforceB2g1Rules run complete after setup. No items should have been removed.");
            window.updateProgressBar(); // Update progress bar based on initial state
        });
    });

    document.getElementById('test1-trigger').addEventListener('click', async () => {
        logToPage('--- Test 1 Trigger clicked ---');
        if (mockCartState.items.length === 0) {
            logToPage("Please run 'Setup Test 1' first.");
            return;
        }
        // Add 1 more Paid SKU A - this should trigger removal of the free item
        addOrUpdateMockItem('SKU_A', 1, 'paid', 'A3key_new_paid');
        logToPage('Trigger: Added 1 more Paid SKU_A. Total: 3 Paid, 1 Free. Expect removal of free item.');
        
        const oldReload = window.location.reload;
        let reloadCalled = false;
        window.location.reload = () => {
            reloadCalled = true;
            logToPage('TEST FAIL: location.reload() was called!');
        };

        await window.enforceB2g1Rules(); // This is the main call to test
        
        window.location.reload = oldReload; // Restore original reload

        if (reloadCalled) {
            logToPage("Verification: Page reload WAS called. TEST FAILED.");
        } else {
            logToPage("Verification: Page reload was NOT called. TEST PASSED.");
        }

        logToPage("Verification: Check console for PubSub/Fallback logs and errors.");
        logToPage(`Verification: Mock Cart State after rule enforcement - Items: ${mockCartState.item_count}`);
        mockCartState.items.forEach(item => {
            logToPage(` -> Key: ${item.key.substring(0,5)}, SKU: ${item.sku}, Qty: ${item.quantity}, Type: ${item.properties._type}`);
        });
        // updateProgressBar is called internally by the modified enforceB2g1Rules,
        // but we can call it again here if needed for final state logging for the test.
        // window.updateProgressBar();
        logToPage("--- Test 1 Trigger complete ---");
    });

    document.getElementById('reset-tests').addEventListener('click', () => {
        logToPage('--- Resetting Tests ---');
        clearCartDOM();
        mockCartState = {item_count: 0, items: [], sections: {}};
        if (window.Shopify && window.Shopify.theme && window.Shopify.theme.pubsub) {
            delete window.Shopify.theme.pubsub; // Remove to test fallback by default
        }
        useMockPubSub = false;
        document.getElementById('main-cart-items').querySelector('.js-contents').innerHTML = '<p>Initial main cart content (Reset).</p>';
        document.getElementById('cart-icon-bubble').innerHTML = '<div class="shopify-section">Initial cart icon bubble (Reset)</div>';
        logToPage('Test environment reset. PubSub mock removed (fallback mode).');
    });

    document.getElementById('test-pubsub').addEventListener('click', () => {
        if (!window.Shopify) window.Shopify = {};
        if (!window.Shopify.theme) window.Shopify.theme = {};
        window.Shopify.theme.pubsub = mockShopify.theme.pubsub;
        useMockPubSub = true;
        logToPage('TEST MODE: PubSub is ENABLED.');
    });
    document.getElementById('test-no-pubsub').addEventListener('click', () => {
        if (window.Shopify && window.Shopify.theme && window.Shopify.theme.pubsub) {
            delete window.Shopify.theme.pubsub;
        }
        useMockPubSub = false;
        logToPage('TEST MODE: PubSub is DISABLED (testing fallback).');
    });
    
    // Initialize in No PubSub mode
    if (window.Shopify && window.Shopify.theme && window.Shopify.theme.pubsub) {
        delete window.Shopify.theme.pubsub;
    }
    logToPage('Initial TEST MODE: PubSub is DISABLED (testing fallback).');

});
