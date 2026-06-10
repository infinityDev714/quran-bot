const https = require('https');
const { LOGO, PAGE_SIZE, SURAHS } = require('./config');

function findSurah(query) {
    query = query.trim().toLowerCase();
    const num = parseInt(query);
    if (!isNaN(num) && num >= 1 && num <= 114) {
        return SURAHS.find(s => s.number === num);
    }
    return SURAHS.find(s =>
        s.name.includes(query) ||
        s.nameEn.toLowerCase().includes(query) ||
        query.includes(s.name)
    );
}


function getSurahUrl(surahNumber, reciterServer) {
    return `${reciterServer}/${String(surahNumber).padStart(3, '0')}.mp3`;
}

function getAyahUrl(surahNum, ayahNum, reciter) {
    const s = String(surahNum).padStart(3, '0');
    const a = String(ayahNum).padStart(3, '0');
    return `https://everyayah.com/data/${reciter.ayahFolder}/${s}${a}.mp3`;
}


function fetchAudioStream(url) {
    return new Promise((resolve, reject) => {
        const request = (targetUrl) => {
            https.get(targetUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return request(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`فشل تحميل الصوت — كود الخطأ ${res.statusCode}`));
                }
                resolve(res);
            }).on('error', reject);
        };
        request(url);
    });
}

function container(accentColor, text) {
    return {
        flags: 32768,
        components: [{
            type: 17,
            accent_color: accentColor,
            components: [
                {
                    type: 9,
                    components: [{ type: 10, content: text }],
                    accessory: { type: 11, media: { url: LOGO } }
                },
                { type: 14 },
                { type: 10, content: '-# All rights reserved by ThailandCodes & Ziad' }
            ]
        }]
    };
}

function surahsPage(page) {
    const totalPages = Math.ceil(SURAHS.length / PAGE_SIZE);
    const slice = SURAHS.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const lines = [];
    for (let i = 0; i < slice.length; i += 2) {
        const a = slice[i];
        const b = slice[i + 1];
        lines.push(b
            ? `\`${b.number}\` ${b.name}　　\`${a.number}\` ${a.name}`
            : `\`${a.number}\` ${a.name}`
        );
    }

    return {
        flags: 32768,
        components: [{
            type: 17,
            accent_color: 0xAA00FF,
            components: [
                {
                    type: 9,
                    components: [{
                        type: 10,
                        content: `## قائمة السور\n${lines.join('\n')}\n\n-# صفحة ${page + 1} من ${totalPages}`
                    }],
                    accessory: { type: 11, media: { url: LOGO } }
                },
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            custom_id: `surahs_${page}_back`,
                            label: '◀ السابق',
                            style: 2,
                            disabled: page === 0
                        },
                        {
                            type: 2,
                            custom_id: `surahs_${page}_next`,
                            label: 'التالي ▶',
                            style: 1,
                            disabled: page === totalPages - 1
                        }
                    ]
                },
                { type: 14 },
                { type: 10, content: '-# All rights reserved by ThailandCodes & Ziad' }
            ]
        }]
    };
}

module.exports = { findSurah, getSurahUrl, getAyahUrl, fetchAudioStream, container, surahsPage };