require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
} = require("@discordjs/voice");
const { REST } = require("@discordjs/rest");
const https = require("https");
const { spawn } = require("child_process");
const ffmpeg = require("ffmpeg-static");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const stations = {
  "Sfera FM": "https://sfera.live24.gr/sfera4132",
  "Rythmos 94.9": "https://rythmos.live24.gr/rythmos",
  "Athens DeeJay 95.2": "https://netradio.live24.gr/athensdeejay",
  "Kiss FM 92.9": "https://kissfm.live24.gr/kissfmathens",
  "Dromos FM 89.8": "http://netradio.live24.gr/dromos2",
  "MAD Radio 106.2": "http://mediaserver.mad.tv/stream",
  "Radio ELGreko": "https://s3.free-shoutcast.com/stream/18192",
  "ERA Sport": "https://radiostreaming.ert.gr/ert-erasport",
  "Easy 97.2": "https://easy972.live24.gr/easy972",
  "Music 89.2": "https://netradio.live24.gr/music892",
  "Skai 100.3": "https://skai.live24.gr/skai1003",
  "Sport FM": "https://sportfm.live24.gr/sportfm7712",
  "Real FM": "https://realfm.live24.gr/realfm",
  "Galaxy 92.0": "https://galaxy.live24.gr/galaxy9292",
  "Crete FM 87.5":
    "https://tls-chrome.live24.gr/1361?http://s3.onweb.gr:8878/;",
  "105.5 Rock":
    "https://tls-chrome.live24.gr/304?http://radio.1055rock.gr:30000/1055",
  "Avanti FM": "https://netradio.live24.gr/radiohotlips",
  "Blackman Radio":
    "https://cloud.123hosting.gr:2200/radio/black9326?mp=/stream",
  "Derti 98.6": "https://derti.live24.gr/derty1000",
  "En Lefko 87.7": "https://stream.rcs.revma.com/trm75ret4c3vv",
  "Hot FM": "https://hotfm.live24.gr/hotfm",
  Lampsi: "https://az11.yesstreaming.net:8140/radio.mp3",
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const connections = new Map(); // key: guildId, value: { connection, player }

client.once("ready", async () => {
  console.log(`✅ Συνδέθηκε ως ${client.user.tag}`);

  // Deploy slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName("play-radio")
      .setDescription("Παίξε έναν ελληνικό ραδιοφωνικό σταθμό")
      .addStringOption((option) =>
        option
          .setName("station")
          .setDescription("Όνομα σταθμού π.χ. sfera")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("stop-radio")
      .setDescription("Σταματάει το ραδιόφωνο"),
    new SlashCommandBuilder()
      .setName("list-stations")
      .setDescription("Δείξε τη λίστα με τους διαθέσιμους σταθμούς"),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash commands deployed.");
  } catch (err) {
    console.error("❌ Σφάλμα στο deploy των εντολών:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guild.id;

  // ===== PLAY RADIO =====
  if (interaction.commandName === "play-radio") {
    const input = interaction.options.getString("station").toLowerCase();
    const matchedStation = Object.entries(stations).find(([name]) =>
      name.toLowerCase().includes(input)
    );

    if (!matchedStation) {
      await interaction.reply({
        content: `⛔ Ο σταθμός "${input}" δεν βρέθηκε.`,
        ephemeral: true,
      });
      return;
    }

    const [stationName, stationUrl] = matchedStation;
    https.get(stationUrl, (res) => {
      console.log(`[${stationName}] Stream status: ${res.statusCode}`);
    });

    const channel = interaction.member.voice.channel;
    if (!channel) {
      await interaction.reply({
        content: `⛔ Πρέπει να είσαι σε voice κανάλι.`,
        ephemeral: true,
      });
      return;
    }

    try {
      await interaction.deferReply();
    } catch (err) {
      console.warn("⚠️ Could not defer reply:", err);
      return; // error there
    }

    const existing = connections.get(guildId);
    if (existing) {
      existing.player.stop();
      existing.connection.destroy();
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    if (!ffmpeg) {
      await interaction.editReply("⛔ Δεν βρέθηκε το ffmpeg binary.");
      return;
    }

    const ffmpegProcess = spawn(ffmpeg, [
      "-i",
      stationUrl,
      "-analyzeduration",
      "0",
      "-loglevel",
      "0",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "pipe:1",
    ]);

    ffmpegProcess.stderr.on("data", (chunk) => {
      console.error(`ffmpeg stderr: ${chunk}`);
    });

    ffmpegProcess.on("error", (err) => {
      console.error("ffmpeg process error:", err);
      interaction.editReply(
        "⚠️ Σφάλμα με το ffmpeg. Μήπως δεν υπάρχει υποστήριξη για το stream;"
      );
      return;
    });

    const resource = createAudioResource(ffmpegProcess.stdout, {
      inputType: StreamType.Raw,
    });

    const player = createAudioPlayer();

    player.play(resource);
    connection.subscribe(player);

    connections.set(guildId, { connection, player });

    player.on(AudioPlayerStatus.Playing, () => {
      interaction.editReply(`📻 Παίζει τώρα: **${stationName}**`);
    });

    player.on("error", (error) => {
      console.error(error);
      interaction.editReply(`⚠️ Σφάλμα: ${error.message}`);
    });
  }

  // ===== STOP RADIO =====
  else if (interaction.commandName === "stop-radio") {
    const existing = connections.get(guildId);

    if (!existing) {
      await interaction.reply({
        content: `⛔ Δεν παίζει κάτι αυτή τη στιγμή.`,
        ephemeral: true,
      });
      return;
    }

    existing.player.stop();
    existing.connection.destroy();
    connections.delete(guildId);

    await interaction.reply(`🛑 Το ραδιόφωνο σταμάτησε.`);
  }

  // ===== LIST STATIONS =====
  else if (interaction.commandName === "list-stations") {
    const list = Object.entries(stations)
      .map(([name, url]) => `🎵 **${name}** → <${url}>`)
      .join("\n");

    await interaction.reply({
      content: `📻 **Διαθέσιμοι Σταθμοί:**\n\n${list}`,
      ephemeral: true,
    });
  }
});

client.on("ready", async () => {
  const appCommands = await client.application.commands.fetch();
  console.log(
    "📜 Commands:",
    [...appCommands.values()].map((cmd) => cmd.name)
  );
});

client.on("voiceStateUpdate", (oldState, newState) => {
  const connection = connections.get(oldState.guild.id);
  if (!connection) return;

  const voiceChannel = oldState.channel;
  if (!voiceChannel) return;

  const nonBotMembers = voiceChannel.members.filter(
    (member) => !member.user.bot
  );
  if (nonBotMembers.size > 0) return;

  connection.player.stop();
  connection.connection.destroy();
  connections.delete(oldState.guild.id);

  console.log(
    `👋 Το bot αποσυνδέθηκε γιατί όλοι έφυγαν από το voice κανάλι (${voiceChannel.name})`
  );
});

client.login(TOKEN);
