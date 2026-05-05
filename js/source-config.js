// 图源配置 —— 添加新图源只需在这里增加一个条目
window.WallpaperApp = window.WallpaperApp || {};
window.WallpaperApp.SOURCE_CONFIG = {
    wallhaven: {
        name: 'Wallhaven',
        baseUrl: 'https://shrill-cherry-eb64.anniecassidyc.workers.dev/',
        buildParams(query, perPage, page, { ratioParam, minWidth, minHeight, purityParam, categoriesParam }) {
            const params = new URLSearchParams();
            params.set('q', query);
            params.set('per_page', perPage);
            params.set('page', page);
            if (ratioParam) params.set('ratios', ratioParam);
            if (purityParam) params.set('purity', purityParam);
            if (categoriesParam && categoriesParam !== '111') params.set('categories', categoriesParam);
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
        buildParams(query, perPage, page, { minWidth, minHeight }) {
            const params = new URLSearchParams();
            params.set('key', this.apiKey);
            params.set('q', query);
            params.set('per_page', perPage);
            params.set('page', page);
            params.set('image_type', 'photo');
            params.set('safesearch', 'true');
            if (minWidth && minHeight) {
                params.set('min_width', minWidth);
                params.set('min_height', minHeight);
            } else if (minWidth) {
                params.set('min_width', minWidth);
            }
            return params;
        },
        getAuthHeader() { return {}; },
        parseResponse(data) {
            const total = data.totalHits || data.total || 0;
            const photos = (data.hits || []).map(p => ({
                id: p.id,
                width: p.imageWidth,
                height: p.imageHeight,
                thumb: p.webformatURL,
                full: p.largeImageURL,
                preview: p.largeImageURL || p.webformatURL,
                alt: p.tags,
                photographer: p.user,
                sourceUrl: p.pageURL,
            }));
            return { total, photos };
        },
        mapRatio() { return ''; },
    },
    unsplash: {
        name: 'Unsplash',
        baseUrl: 'https://api.unsplash.com/search/photos',
        buildParams(query, perPage, page, { orientation }) {
            const params = new URLSearchParams();
            params.set('query', query);
            params.set('per_page', perPage);
            params.set('page', page);
            if (orientation) params.set('orientation', orientation);
            return params;
        },
        getAuthHeader(apiKey) { return { 'Authorization': `Client-ID ${apiKey}` }; },
        parseResponse(data) {
            const total = data.total || 0;
            const photos = (data.results || []).map(p => ({
                id: p.id,
                width: p.width,
                height: p.height,
                thumb: p.urls?.small,
                full: p.urls?.raw + '&w=2560',
                preview: p.urls?.regular || p.urls?.small,
                alt: p.alt_description || p.description || '',
                photographer: p.user?.name,
                sourceUrl: p.links?.html,
            }));
            return { total, photos };
        },
        mapRatio(selected) {
            if (selected === '1:1') return 'squarish';
            if (['9:16', '16:9', '21:9', '3:2', '4:3', '16:10'].includes(selected)) {
                const w = parseInt(selected.split(':')[0]);
                const h = parseInt(selected.split(':')[1]);
                return w >= h ? 'landscape' : 'portrait';
            }
            return '';
        },
    },
};
