const { Client, GatewayIntentBits } = require('discord.js');
const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

const { TOKEN }         = require('./config');
const { registerEvents } = require('./events');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

registerEvents(client);

client.once('ready', () => {
    console.log(`✅ البوت شغال: ${client.user.tag}`);
    client.user.setActivity('القرآن الكريم 💖', { type: 3 });
});

client.on('error', (error) => {
    console.error('❌ خطأ في الكلاينت:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ خطأ غير متوقع:', error.message);
});

client.login(TOKEN);