// 图源配置 —— 添加新图源只需在这里增加一个条目
window.WallpaperApp = window.WallpaperApp || {};

const SOURCE_CONFIG = {
    wallhaven: {
        name: 'Wallhaven',
        baseUrl: 'https://shrill-cherry-eb64.anniecassidyc.workers.dev/',
        buildParams(query, perPage, page, { ratioParam, minWidth, minHeight, purityParam }) {
            const params = new URLSearchParams();
            params.set('q', query);
            params.set('per_page', perPage);
            params.set('page', page);
            if (ratioParam) params.set('ratios', ratioParam);
            if (purityParam) params.set('purity', purityParam);
            if (minWidth && minHeight) {
                params.set('atleast', `${minWidth}x${minHeight}`);
            } else if (minWidth) {
                params.set('atleast', `${minWidth}x0`);
            }
            return params;
        },
        getAuthHeader(apiKey) {
            return { 'X-API-Key': apiKey };
        },
        parseResponse(data) {
            const total = data.meta?.total || 0;
            const photos = (data.data || []).map(p => ({
                id: p.id,
                width: p.dimension_x,
                height: p.dimension_y,
                thumb: p.thumbs?.small || p.thumbs?.original,
                medium: p.thumbs?.original,
                full: p.path,
                preview: p.thumbs?.large || p.thumbs?.original,
                alt: p.category || '',
                purity: p.purity || 'sfw',
                photographer: 'Wallhaven',
                sourceUrl: p.url,
            }));
            return { total, photos };
        },
        mapRatio(selected) {
            const mapping = {
                '16:9': '16x9', '16:10': '16x10', '21:9': '21x9',
                '4:3': '4x3', '3:2': '3x2', '1:1': '1x1',
            };
            return mapping[selected] || '';
        },
    },
    pixabay: {
        name: 'Pixabay',
        baseUrl: 'https://pixabay.com/api/',
        buildParams(query, perPage, page, { ratioParam, minWidth, minHeight }) {
            const params = new URLSearchParams();
            params.set('key', 'API_KEY_PLACEHOLDER'); // replaced at call site
            params.set('q', query);
            params.set('per_page', String(perPage));
            params.set('page', String(page));
            params.set('safesearch', 'true');
            params.set('image_type', 'photo');
            if (minWidth && minHeight) {
                params.set('min_width', String(minWidth));
                params.set('min_height', String(minHeight));
            } else if (minWidth) {
                params.set('min_width', String(minWidth));
            }
            if (ratioParam === '16x9' || ratioParam === '16:9') params.set('orientation', 'horizontal');
            else if (ratioParam === '9x16' || ratioParam === '9:16') params.set('orientation', 'vertical');
            return params;
        },
        getAuthHeader() { return {}; },
        parseResponse(data) {
            const total = data.totalHits || 0;
            const photos = (data.hits || []).map(p => ({
                id: String(p.id),
                width: p.imageWidth,
                height: p.imageHeight,
                thumb: p.previewURL,
                medium: p.largeImageURL,
                full: p.fullHDURL || p.largeImageURL,
                preview: p.webformatURL,
                alt: p.tags || '',
                purity: 'sfw',
                photographer: p.user || 'Pixabay',
                sourceUrl: p.pageURL,
            }));
            return { total, photos };
        },
        mapRatio() { return ''; },
    },
    unsplash: {
        name: 'Unsplash',
        baseUrl: 'https://api.unsplash.com/',
        buildParams(query, perPage, page, { minWidth, minHeight }) {
            const params = new URLSearchParams();
            params.set('query', query);
            params.set('per_page', String(perPage));
            params.set('page', String(page));
            if (minWidth && minHeight) {
                // Unsplash doesn't support min dimensions, filter post-query
            }
            return params;
        },
        getAuthHeader(apiKey) {
            return { 'Authorization': `Client-ID ${apiKey}` };
        },
        parseResponse(data) {
            const total = data.total || 0;
            const photos = (data.results || []).map(p => ({
                id: p.id,
                width: p.width,
                height: p.height,
                thumb: p.urls?.thumb || p.urls?.small,
                medium: p.urls?.regular,
                full: p.urls?.raw || p.urls?.full,
                preview: p.urls?.small || p.urls?.thumb,
                alt: p.alt_description || p.description || '',
                purity: 'sfw',
                photographer: p.user?.name || 'Unsplash',
                sourceUrl: p.links?.html || '',
            }));
            return { total, photos };
        },
        mapRatio() { return ''; },
    },
};

export { SOURCE_CONFIG };

// backward compat
window.WallpaperApp.SOURCE_CONFIG = SOURCE_CONFIG;
