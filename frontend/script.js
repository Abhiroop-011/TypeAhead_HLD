(() => {
    'use strict';
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const searchLoading = document.getElementById('search-loading');
    const suggestionsContainer = document.getElementById('suggestions-container');
    const suggestionsList = document.getElementById('suggestions-list');
    const searchResult = document.getElementById('search-result');
    const resultJson = document.getElementById('result-json');
    const trendingGrid = document.getElementById('trending-grid');
    const trendingLoading = document.getElementById('trending-loading');
    const errorToast = document.getElementById('error-toast');
    const errorMessage = document.getElementById('error-message');
    const errorClose = document.getElementById('error-close');
    const cacheBadgeContainer = document.getElementById('cache-badge-container');
    const cacheBadgeText = document.getElementById('cache-badge-text');
    const API_BASE = window.location.origin + '/api';
    let debounceTimer = null;
    let activeIndex = -1;        
    let currentSuggestions = [];  
    let trendingInterval = null;
    function debounce(fn, delay) {
        return (...args) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => fn(...args), delay);
        };
    }
    async function fetchSuggestions(query) {
        if (!query || query.length < 1) {
            hideSuggestions();
            return;
        }
        cacheBadgeContainer.hidden = false;
        cacheBadgeText.textContent = 'Loading...';
        cacheBadgeText.className = 'cache-status-loading';
        try {
            const res = await fetch(`${API_BASE}/suggest?q=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            currentSuggestions = data.suggestions || [];
            activeIndex = -1;
            if (currentSuggestions.length > 0) {
                renderSuggestions(currentSuggestions);
                const isHit = data.source === 'cache';
                const shardName = data.shard || 'unknown';
                if (isHit) {
                    cacheBadgeText.textContent = `Cache Hit (${shardName.toUpperCase()})`;
                    cacheBadgeText.className = 'cache-status-hit';
                } else {
                    cacheBadgeText.textContent = 'Cache Miss (DB Fetch)';
                    cacheBadgeText.className = 'cache-status-miss';
                }
                showSuggestions();
            } else {
                hideSuggestions();
                cacheBadgeContainer.hidden = true;
            }
        } catch (err) {
            console.error('[Suggest] Error:', err);
            showError('Failed to fetch suggestions. Check your connection.');
            cacheBadgeContainer.hidden = true;
        }
    }
    const debouncedFetch = debounce(fetchSuggestions, 300);
    function renderSuggestions(suggestions) {
        suggestionsList.innerHTML = suggestions.map((text, i) => `
            <li class="suggestion-item" role="option" data-index="${i}" id="suggestion-${i}">
                <svg class="suggestion-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <span class="suggestion-item-text">${escapeHtml(text)}</span>
            </li>
        `).join('');
        suggestionsList.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.index);
                selectSuggestion(idx);
            });
        });
    }
    searchInput.addEventListener('keydown', (e) => {
        if (!suggestionsContainer.hidden && currentSuggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = Math.min(activeIndex + 1, currentSuggestions.length - 1);
                updateActiveItem();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = Math.max(activeIndex - 1, -1);
                updateActiveItem();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (activeIndex >= 0) {
                    selectSuggestion(activeIndex);
                } else {
                    submitSearch(searchInput.value);
                }
            } else if (e.key === 'Escape') {
                hideSuggestions();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            submitSearch(searchInput.value);
        }
    });
    function updateActiveItem() {
        suggestionsList.querySelectorAll('.suggestion-item').forEach((item, i) => {
            item.classList.toggle('active', i === activeIndex);
            if (i === activeIndex) {
                item.scrollIntoView({ block: 'nearest' });
            }
        });
    }
    function selectSuggestion(index) {
        const query = currentSuggestions[index];
        searchInput.value = query;
        hideSuggestions();
        submitSearch(query);
    }
    async function submitSearch(query) {
        if (!query || !query.trim()) return;
        hideSuggestions();
        cacheBadgeContainer.hidden = false;
        cacheBadgeText.textContent = 'Loading...';
        cacheBadgeText.className = 'cache-status-loading';
        try {
            const res = await fetch(`${API_BASE}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query.trim() })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            resultJson.textContent = JSON.stringify(data, null, 2);
            searchResult.hidden = false;
            setTimeout(fetchTrending, 2000);
        } catch (err) {
            console.error('[Search] Error:', err);
            showError('Search failed. Please try again.');
        } finally {
            cacheBadgeContainer.hidden = true;
        }
    }
    searchButton.addEventListener('click', () => {
        submitSearch(searchInput.value);
    });
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length === 0) {
            hideSuggestions();
            searchResult.hidden = true;
            cacheBadgeContainer.hidden = true;
        } else {
            debouncedFetch(query);
        }
    });
    async function fetchTrending() {
        try {
            const res = await fetch(`${API_BASE}/trending`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const trending = data.trending || [];
            if (trendingLoading) trendingLoading.remove();
            if (trending.length === 0) {
                trendingGrid.innerHTML = '<div class="trending-loading"><span>No trending data yet. Try searching!</span></div>';
                return;
            }
            trendingGrid.innerHTML = trending.map((item, i) => `
                <div class="trending-item" data-query="${escapeHtml(item.query)}" id="trending-item-${i}">
                    <div class="trending-rank">${i + 1}</div>
                    <span class="trending-query">${escapeHtml(item.query)}</span>
                    <span class="trending-score">${formatScore(item.score)}</span>
                </div>
            `).join('');
            trendingGrid.querySelectorAll('.trending-item').forEach(item => {
                item.addEventListener('click', () => {
                    searchInput.value = item.dataset.query;
                    submitSearch(item.dataset.query);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                });
            });
        } catch (err) {
            console.error('[Trending] Error:', err);
        }
    }
    function showSuggestions() {
        suggestionsContainer.hidden = false;
    }
    function hideSuggestions() {
        suggestionsContainer.hidden = true;
        activeIndex = -1;
        currentSuggestions = [];
    }
    function showError(msg) {
        errorMessage.textContent = msg;
        errorToast.hidden = false;
        setTimeout(() => { errorToast.hidden = true; }, 5000);
    }
    errorClose.addEventListener('click', () => {
        errorToast.hidden = true;
    });
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    function formatScore(score) {
        if (score >= 1000000) return (score / 1000000).toFixed(1) + 'M';
        if (score >= 1000) return (score / 1000).toFixed(1) + 'K';
        return Math.round(score).toString();
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            hideSuggestions();
        }
    });
    fetchTrending();
    trendingInterval = setInterval(fetchTrending, 30000);
    searchInput.focus();
    console.log('[TypeaheadUI] Initialized — Debounce: 300ms, Trending refresh: 30s');
})();
