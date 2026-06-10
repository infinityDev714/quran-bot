const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    StreamType,
    getVoiceConnection,
} = require('@discordjs/voice');

const { RECITERS, SURAHS, SURAH_AYAH_COUNTS } = require('./config');
const { khatmaMap, repeatMap, progressMap }    = require('./state');
const { findSurah, getSurahUrl, getAyahUrl, fetchAudioStream, container, surahsPage } = require('./utils');

function safeDestroyConnection(connection) {
    try {
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            connection.destroy();
        }
    } catch (_) {}
}

async function playKhatmaSurah(guildId) {
    const state = khatmaMap.get(guildId);
    if (!state) return;

    const surah = SURAHS[state.index];
    try {
        const stream   = await fetchAudioStream(getSurahUrl(surah.number, state.reciter.server));
        const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
        state.player.play(resource);

        const progressBar = `${state.index + 1} / ${SURAHS.length}`;
        await state.statusMsg.edit(container(0xAA00FF,
            `## 📖 الختمة جارية...\n**بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ**\n\n` +
            `🎙️ **القارئ:** ${state.reciter.name}\n` +
            `📚 **الآن:** سورة **${surah.name}** (${surah.nameEn})\n` +
            `🔢 **التقدم:** ${progressBar}\n` +
            `🔊 **الفويس:** ${state.voiceChannelName}\n\n` +
            `-# اكتب !stop لإيقاف الختمة`
        )).catch(() => {});

    } catch (_) {
        state.index++;
        if (state.index < SURAHS.length) {
            playKhatmaSurah(guildId);
        } else {
            finishKhatma(guildId);
        }
    }
}

async function finishKhatma(guildId) {
    const state = khatmaMap.get(guildId);
    if (!state) return;
    progressMap.delete(`${state.userId}_${guildId}`);
    khatmaMap.delete(guildId);
    safeDestroyConnection(state.connection);
    state.channel.send(container(0xAA00FF,
        '## ✅ اكتملت الختمة!\n*صدق الله العظيم* 🤲'
    )).catch(() => {});
}

async function playRepeatAyah(guildId) {
    const state = repeatMap.get(guildId);
    if (!state) return;

    try {
        const url      = getAyahUrl(state.surahNum, state.ayahNum, state.reciter);
        const stream   = await fetchAudioStream(url);
        const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
        state.player.play(resource);
    } catch (err) {
        console.error('خطأ في تكرار الآية:', err.message);
        repeatMap.delete(guildId);
        safeDestroyConnection(state.connection);
        state.channel.send(container(0xAA00FF,
            `## ❌ خطأ في تشغيل الآية\n${err.message}`
        )).catch(() => {});
    }
}

async function cmdPlay(message, args) {
    let reciterIndex = null;
    let queryParts   = [...args];
    const lastArg    = args[args.length - 1];

    if (args.length > 1 && !isNaN(lastArg)) {
        const idx = parseInt(lastArg) - 1;
        if (idx >= 0 && idx < RECITERS.length) {
            reciterIndex = idx;
            queryParts   = args.slice(0, -1);
        }
    }

    const query        = queryParts.join(' ').trim();
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) {
        return message.reply(container(0xAA00FF, '## ❌ لازم تدخل فويس أول!'));
    }
    if (!query) {
        return message.reply(container(0xAA00FF,
            '## ❌ اكتب اسم السورة!\n**مثال:**\n`!play الفاتحة`\n`!play الكهف`\n`!play يس`\n`!play 36`\n`!play تختيم`\n`!play تختيم استكمال`'
        ));
    }

    const reciter = reciterIndex !== null
        ? RECITERS[reciterIndex]
        : RECITERS[Math.floor(Math.random() * RECITERS.length)];

    if (query === 'تختيم' || query === 'khatma' || query === 'تختيم استكمال') {
        const isResume = query === 'تختيم استكمال';
        const saved    = progressMap.get(`${message.author.id}_${message.guild.id}`);

        if (isResume && !saved) {
            return message.reply(container(0xAA00FF,
                '## ❌ مفيش ختمة محفوظة!\nابدأ ختمة جديدة بـ `!play تختيم`'
            ));
        }

        const startIndex      = isResume ? saved.surahIndex : 0;
        const effectiveReciter = isResume ? RECITERS[saved.reciterIndex] ?? reciter : reciter;
        const startSurah      = SURAHS[startIndex];

        const loadingMsg = await message.reply(container(0xAA00FF,
            `## ⏳ جاري تجهيز ${isResume ? 'استكمال ' : ''}الختمة...\n🎙️ القارئ: **${effectiveReciter.name}**`
        ));

        try {
            const connection = joinVoiceChannel({
                channelId:       voiceChannel.id,
                guildId:         message.guild.id,
                adapterCreator:  message.guild.voiceAdapterCreator,
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

            const player = createAudioPlayer();
            connection.subscribe(player);

            // حفظ الحالة
            khatmaMap.set(message.guild.id, {
                index:            startIndex,
                reciter:          effectiveReciter,
                connection,
                player,
                channel:          message.channel,
                userId:           message.author.id,
                voiceChannelName: voiceChannel.name,
                statusMsg:        loadingMsg,
            });

            await loadingMsg.edit(container(0xAA00FF,
                `## 📖 ${isResume ? 'استُكملت' : 'بدأت'} الختمة!\n**بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ**\n\n` +
                `🎙️ **القارئ:** ${effectiveReciter.name}\n` +
                `📚 **من:** ${startSurah.name} → الناس\n` +
                `🔊 **الفويس:** ${voiceChannel.name}\n\n` +
                `-# اكتب !stop لإيقاف الختمة`
            ));

            player.on(AudioPlayerStatus.Idle, async () => {
                const state = khatmaMap.get(message.guild.id);
                if (!state) return;

                state.index++;
                if (state.index >= SURAHS.length) {
                    await finishKhatma(message.guild.id);
                } else {
                    progressMap.set(`${state.userId}_${message.guild.id}`, {
                        surahIndex:   state.index,
                        reciterIndex: RECITERS.indexOf(state.reciter),
                    });
                    await playKhatmaSurah(message.guild.id);
                }
            });

            player.on('error', async (err) => {
                console.error('خطأ في الختمة:', err.message);
                const state = khatmaMap.get(message.guild.id);
                if (!state) return;
                state.index++;
                if (state.index < SURAHS.length) {
                    await playKhatmaSurah(message.guild.id);
                } else {
                    await finishKhatma(message.guild.id);
                }
            });

            await playKhatmaSurah(message.guild.id);

        } catch (err) {
            console.error('❌ خطأ في الختمة:', err.message);
            await loadingMsg.edit(container(0xAA00FF,
                `## ❌ مشكلة في التشغيل\n**السبب:** ${err.message}`
            ));
        }

        return;
    }

    const surah = findSurah(query);
    if (!surah) {
        return message.reply(container(0xAA00FF,
            `## ❌ السورة مش موجودة!\nمش قادر ألاقي سورة باسم **"${query}"**\n\nاكتب اسم السورة أو رقمها من 1 إلى 114`
        ));
    }

    const loadingMsg = await message.reply(container(0xAA00FF,
        `## ⏳ جاري التحضير...\n🔍 بجيب سورة **${surah.name}** بصوت **${reciter.name}**`
    ));

    try {
        const audioStream = await fetchAudioStream(getSurahUrl(surah.number, reciter.server));

        const connection = joinVoiceChannel({
            channelId:      voiceChannel.id,
            guildId:        message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

        const player   = createAudioPlayer();
        const resource = createAudioResource(audioStream, { inputType: StreamType.Arbitrary });
        connection.subscribe(player);
        player.play(resource);

        await loadingMsg.edit(container(0xAA00FF,
            `## 📖 يتلى الآن...\n**بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ**\n\n` +
            `📚 **السورة:** ${surah.name} (${surah.nameEn})\n` +
            `🔢 **رقم السورة:** ${surah.number}\n` +
            `🎙️ **القارئ:** ${reciter.name}\n` +
            `🔊 **الفويس:** ${voiceChannel.name}\n\n` +
            `-# اكتب !stop لإيقاف التلاوة`
        ));

        player.on(AudioPlayerStatus.Idle, () => {
            safeDestroyConnection(connection);
            message.channel.send(container(0xAA00FF,
                `## ✅ انتهت التلاوة\nانتهت تلاوة سورة **${surah.name}** بصوت **${reciter.name}**\n\n*صدق الله العظيم* 🤲`
            )).catch(() => {});
        });

        player.on('error', (err) => {
            console.error('خطأ في التشغيل:', err.message);
            safeDestroyConnection(connection);
            message.channel.send(container(0xAA00FF,
                '## ❌ خطأ في التشغيل\nفي مشكلة في تشغيل التلاوة، جرب تاني'
            )).catch(() => {});
        });

    } catch (err) {
        console.error('❌ خطأ:', err.message);
        await loadingMsg.edit(container(0xAA00FF,
            `## ❌ مشكلة في التشغيل\n**السبب:** ${err.message}\n\nتأكد من صلاحيات البوت أو جرب سورة تانية`
        ));
    }
}


async function cmdRepeat(message, args) {
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) {
        return message.reply(container(0xAA00FF, '## ❌ لازم تدخل فويس أول!'));
    }

    if (args.length < 2) {
        return message.reply(container(0xAA00FF,
            '## ❌ الصيغة الصحيحة:\n`!repeat [سورة] [رقم الآية]`\n\n**أمثلة:**\n`!repeat الفاتحة 1`\n`!repeat البقرة 255`\n`!repeat 36 1`\n`!repeat الكهف 10 2` ← الشيخ رقم 2'
        ));
    }

    let reciterIndex = null;
    let workArgs     = [...args];
    const last       = workArgs[workArgs.length - 1];
    if (!isNaN(last) && parseInt(last) >= 1 && parseInt(last) <= RECITERS.length) {
        const secondLast = workArgs[workArgs.length - 2];
        if (!isNaN(secondLast)) {
            reciterIndex = parseInt(last) - 1;
            workArgs     = workArgs.slice(0, -1);
        }
    }

    const ayahNum  = parseInt(workArgs[workArgs.length - 1]);
    const surahArg = workArgs.slice(0, -1).join(' ').trim();

    if (isNaN(ayahNum) || ayahNum < 1) {
        return message.reply(container(0xAA00FF,
            '## ❌ رقم الآية لازم يكون رقم صحيح!\n**مثال:** `!repeat الفاتحة 1`'
        ));
    }

    const surah = findSurah(surahArg);
    if (!surah) {
        return message.reply(container(0xAA00FF,
            `## ❌ السورة مش موجودة!\nمش قادر ألاقي سورة باسم **"${surahArg}"**`
        ));
    }

    const maxAyah = SURAH_AYAH_COUNTS[surah.number - 1];
    if (ayahNum > maxAyah) {
        return message.reply(container(0xAA00FF,
            `## ❌ رقم الآية خاطئ!\nسورة **${surah.name}** فيها **${maxAyah}** آية فقط`
        ));
    }

    const reciter = reciterIndex !== null
        ? RECITERS[reciterIndex]
        : RECITERS[Math.floor(Math.random() * RECITERS.length)];

    const loadingMsg = await message.reply(container(0xAA00FF,
        `## ⏳ جاري التحضير...\n🔄 جاري تجهيز تكرار الآية **${ayahNum}** من سورة **${surah.name}**`
    ));

    try {
        const connection = joinVoiceChannel({
            channelId:      voiceChannel.id,
            guildId:        message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

        const player = createAudioPlayer();
        connection.subscribe(player);

        repeatMap.set(message.guild.id, {
            surahNum: surah.number,
            ayahNum,
            reciter,
            connection,
            player,
            channel: message.channel,
        });

        await loadingMsg.edit(container(0xAA00FF,
            `## 🔄 تكرار الآية\n**بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ**\n\n` +
            `📚 **السورة:** ${surah.name} — آية **${ayahNum}** من ${maxAyah}\n` +
            `🎙️ **القارئ:** ${reciter.name}\n` +
            `🔊 **الفويس:** ${voiceChannel.name}\n\n` +
            `-# اكتب !stop لإيقاف التكرار`
        ));

        player.on(AudioPlayerStatus.Idle, async () => {
            if (!repeatMap.has(message.guild.id)) return;
            await playRepeatAyah(message.guild.id);
        });

        player.on('error', async (err) => {
            console.error('خطأ في التكرار:', err.message);
            repeatMap.delete(message.guild.id);
            safeDestroyConnection(connection);
            message.channel.send(container(0xAA00FF,
                `## ❌ خطأ في التكرار\n${err.message}`
            )).catch(() => {});
        });

        await playRepeatAyah(message.guild.id);

    } catch (err) {
        console.error('❌ خطأ في !repeat:', err.message);
        await loadingMsg.edit(container(0xAA00FF,
            `## ❌ مشكلة في التشغيل\n**السبب:** ${err.message}`
        ));
    }
}

async function cmdStop(message) {
    if (!message.member?.voice?.channel) {
        return message.reply(container(0xAA00FF, '## ❌ مش في فويس!'));
    }

    const guildId = message.guild.id;

    const khatmaState = khatmaMap.get(guildId);
    if (khatmaState) {
        progressMap.set(`${message.author.id}_${guildId}`, {
            surahIndex:   khatmaState.index,
            reciterIndex: RECITERS.indexOf(khatmaState.reciter),
        });
        khatmaMap.delete(guildId);
    }

    repeatMap.delete(guildId);

    const connection = getVoiceConnection(guildId);
    if (!connection) {
        return message.reply(container(0xAA00FF, '## ❌ مفيش تلاوة شغالة دلوقتي!'));
    }

    safeDestroyConnection(connection);

    const extraNote = khatmaState
        ? `\n-# تقدم الختمة محفوظ عند **${SURAHS[khatmaState.index]?.name ?? 'الناس'}** — اكتب \`!play تختيم استكمال\` للمتابعة`
        : '';

    return message.reply(container(0x00b894,
        `## ⏹️ تم إيقاف التلاوة\n*جزاكم الله خيراً* 🤲${extraNote}`
    ));
}

function cmdSurahs(message) {
    return message.reply(surahsPage(0));
}

function cmdReciters(message) {
    const list = RECITERS.map((r, i) => `\`${i + 1}\` 🎙️ ${r.name}`).join('\n');
    return message.reply(container(0x6c5ce7,
        `## 🎙️ الشيوخ المتاحين\n${list}\n\n-# مثال: \`!play الفاتحة 2\` ← لاختيار شيخ معين`
    ));
}

function cmdHelp(message) {
    return message.reply(container(0x6c5ce7,
        `## 📖 أوامر بوت القرآن\n\n` +
        `\`!play [سورة]\` — تشغيل سورة بشيخ عشوائي\n` +
        `\`!play [سورة] [رقم الشيخ]\` — تشغيل سورة بشيخ معين\n` +
        `\`!play تختيم\` — ختمة كاملة من الفاتحة للناس\n` +
        `\`!play تختيم استكمال\` — استكمال الختمة من آخر نقطة توقفت عندها\n` +
        `\`!repeat [سورة] [رقم الآية]\` — تكرار آية بشكل مستمر حتى !stop\n` +
        `\`!repeat [سورة] [رقم الآية] [رقم الشيخ]\` — تكرار بشيخ معين\n` +
        `\`!stop\` — إيقاف التلاوة أو الختمة أو التكرار\n` +
        `\`!surahs\` — قائمة كل السور\n` +
        `\`!reciters\` — قائمة الشيوخ\n\n` +
        `**📌 أمثلة:**\n` +
        `\`!play الكهف 1\` ← مشاري العفاسي\n` +
        `\`!play تختيم 3\` ← ختمة بصوت المنشاوي\n` +
        `\`!repeat البقرة 255\` ← آية الكرسي تتكرر\n` +
        `\`!repeat الفاتحة 1 2\` ← الفاتحة تتكرر بصوت الحصري\n\n` +
        `-# بوت القرآن الكريم 🕌`
    ));
}

function registerEvents(client) {

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('surahs_')) return;

        const parts      = interaction.customId.split('_');
        const currentPage = parseInt(parts[1]);
        const dir        = parts[2];
        const newPage    = dir === 'next' ? currentPage + 1 : currentPage - 1;

        await interaction.update(surahsPage(newPage));
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const content = message.content.trim();
        const lower   = content.toLowerCase();
        if (lower.startsWith('!play') || lower.startsWith('!قران')) {
            const args = content.split(/\s+/).slice(1);
            return cmdPlay(message, args);
        }
        if (lower.startsWith('!repeat') || lower.startsWith('!كرر')) {
            const args = content.split(/\s+/).slice(1);
            return cmdRepeat(message, args);
        }
        if (lower === '!stop' || lower === '!وقف') {
            return cmdStop(message);
        }
        if (lower === '!surahs' || lower === '!سور') {
            return cmdSurahs(message);
        }
        if (lower === '!reciters' || lower === '!شيوخ') {
            return cmdReciters(message);
        }
        if (lower === '!help' || lower === '!مساعدة') {
            return cmdHelp(message);
        }
    });
}

module.exports = { registerEvents };