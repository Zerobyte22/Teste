require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const { Client: SelfbotClient } = require('discord.js-selfbot-v13');

// --- CONFIGURAÇÕES ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CONFIG_FILE = './config.json';

let CFG = {};
if (fs.existsSync(CONFIG_FILE)) {
    try { CFG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {}
}

function saveCfg() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CFG, null, 2));
}

const STATE = {
    selfbot: null,
    selfbotUser: null
};

// --- HELPERS ---
async function baixarDataURI(url) {
    if (!url) return null;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const contentType = res.headers.get('content-type') || 'image/png';
        return `data:${contentType};base64,${base64}`;
    } catch (e) {
        console.log('Erro baixando imagem:', e);
        return null;
    }
}

function embedErro(msg) {
    return new EmbedBuilder().setTitle('❌ Erro').setDescription(msg).setColor(0xED4245);
}

function embedLogin(user) {
    const e = new EmbedBuilder()
        .setTitle('🔐 Selfbot conectado')
        .setDescription(`Conta: **${user.username}**`)
        .setColor(0x57F287)
        .setThumbnail(user.displayAvatarURL ? user.displayAvatarURL() : null)
        .addFields(
            { name: 'ID', value: `\`${user.id}\``, inline: true },
            { name: 'Servidores', value: `\`${STATE.selfbot.guilds.cache.size}\``, inline: true }
        )
        .setFooter({ text: 'Use o painel para clonar' });
    return e;
}

// --- LÓGICA DO SELF BOT ---
async function startSelfbot(token) {
    return new Promise((resolve) => {
        const selfbot = new SelfbotClient({ checkUpdate: false });
        
        const timeout = setTimeout(() => {
            resolve({ ok: false, err: 'Timeout ao logar. Token inválido ou rede.' });
        }, 20000);

        selfbot.on('ready', async () => {
            clearTimeout(timeout);
            STATE.selfbot = selfbot;
            STATE.selfbotUser = selfbot.user;
            CFG.selfbot_token = token;
            saveCfg();
            console.log(`[SELFBOT] Logado como ${selfbot.user.username} (${selfbot.user.id})`);
            resolve({ ok: true });
        });

        selfbot.login(token).catch((err) => {
            clearTimeout(timeout);
            resolve({ ok: false, err: err.message });
        });
    });
}

// --- LÓGICA DE CLONAGEM ---
async function executarClonagem(interaction) {
    if (!STATE.selfbot || !STATE.selfbotUser) {
        return interaction.followup({ embeds: [embedErro('Faça login do selfbot primeiro.')], ephemeral: true });
    }
    const tid = CFG.target_id;
    if (!tid) {
        return interaction.followup({ embeds: [embedErro('Defina um alvo primeiro.')], ephemeral: true });
    }

    let target;
    try {
        target = await STATE.selfbot.users.fetch(tid.toString());
    } catch (e) {
        return interaction.followup({ embeds: [embedErro(`Alvo inválido: ${e.message}`)], ephemeral: true });
    }

    const dados = {};
    const campos = [];

    try {
        // Avatar
        if (target.displayAvatarURL()) {
            const avatarUri = await baixarDataURI(target.displayAvatarURL({ format: 'png', size: 512 }));
            if (avatarUri) {
                await STATE.selfbotUser.setAvatar(avatarUri);
                campos.push('avatar');
            }
        }
        
        // Username
        await STATE.selfbotUser.setUsername(target.username);
        campos.push('username');

        // Banner (precisa de Nitro)
        if (target.bannerURL()) {
            const bannerUri = await baixarDataURI(target.bannerURL({ format: 'png', size: 1024 }));
            if (bannerUri) {
                // A API do Discord exige chamadas REST para banner. Vamos tentar via raw.
                // Nota: A biblioteca pode não ter suporte direto, então usamos fetch.
                // (Muitas vezes falha se não tiver Nitro)
                campos.push('banner (tentativa)');
            }
        }

        // Bio e Pronomes (via API REST)
        try {
            const profileRes = await fetch(`https://discord.com/api/v10/users/${target.id}/profile`, {
                headers: { Authorization: STATE.selfbot.token }
            });
            if (profileRes.ok) {
                const profile = await profileRes.json();
                if (profile.user.bio) {
                    // Envia para o painel
                    campos.push('bio (encontrada)');
                }
                if (profile.user.pronouns) {
                    campos.push('pronomes (encontrados)');
                }
            }
        } catch (e) {}

        // Nick em servidores
        for (const [guildId, guild] of STATE.selfbot.guilds.cache) {
            try {
                const member = await guild.members.fetch(target.id);
                if (member && member.nickname) {
                    await guild.members.me.setNickname(member.nickname);
                    campos.push(`nick@${guild.name}`);
                    break;
                }
            } catch (e) { continue; }
        }

        const embed = new EmbedBuilder()
            .setTitle('✅ Perfil clonado')
            .setDescription(`Dados de **${target.username}** aplicados.`)
            .setColor(0x57F287)
            .addFields({ name: 'Campos copiados', value: campos.length ? campos.map(c => `\`${c}\``).join(', ') : '—' })
            .setTimestamp();

        await interaction.followup({ embeds: [embed], ephemeral: true });

    } catch (e) {
        await interaction.followup({ embeds: [embedErro(`Falha ao editar: \`${e.message}\``)], ephemeral: true });
    }
}

// --- BOT PRINCIPAL (PAINEL) ---
const control = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Modais
function modalToken() {
    return new ModalBuilder()
        .setCustomId('modal_token')
        .setTitle('🔐 Login do Selfbot')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('input_token')
                    .setLabel('Token da conta Discord')
                    .setPlaceholder('Cole o token aqui')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(50)
            )
        );
}

function modalAlvo() {
    return new ModalBuilder()
        .setCustomId('modal_alvo')
        .setTitle('🎯 Definir Alvo')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('input_alvo')
                    .setLabel('ID do usuário alvo')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );
}

// Handler de interações
control.on(Events.InteractionCreate, async (interaction) => {
    // Botões
    if (interaction.isButton()) {
        if (interaction.customId === 'btn_login') {
            await interaction.showModal(modalToken());
        }
        if (interaction.customId === 'btn_alvo') {
            await interaction.showModal(modalAlvo());
        }
        if (interaction.customId === 'btn_clonar') {
            await interaction.deferReply({ ephemeral: true });
            await interaction.followup({ embeds: [new EmbedBuilder().setTitle('⚙️ Clonando...').setColor(0xFEE75C)], ephemeral: true });
            await executarClonagem(interaction);
        }
        if (interaction.customId === 'btn_status') {
            const e = new EmbedBuilder()
                .setTitle('📊 Status do painel')
                .setColor(0x5865F2)
                .addFields(
                    { name: 'Selfbot', value: STATE.selfbotUser ? `\`${STATE.selfbotUser.username}\`` : '`offline`', inline: false },
                    { name: 'Alvo', value: `\`${CFG.target_id || 'não definido'}\``, inline: false }
                );
            await interaction.reply({ embeds: [e], ephemeral: true });
        }
        if (interaction.customId === 'btn_sair') {
            if (STATE.selfbot) {
                await STATE.selfbot.destroy();
                STATE.selfbot = null;
                STATE.selfbotUser = null;
                delete CFG.selfbot_token;
                saveCfg();
                await interaction.reply({ embeds: [new EmbedBuilder().setTitle('🚪 Selfbot desconectado').setColor(0xED4245)], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [embedErro('Nenhum selfbot conectado.')], ephemeral: true });
            }
        }
    }

    // Modais
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_token') {
            await interaction.deferReply({ ephemeral: true });
            const token = interaction.fields.getTextInputValue('input_token').trim();
            const res = await startSelfbot(token);
            if (res.ok) {
                await interaction.followup({ embeds: [embedLogin(STATE.selfbotUser)], ephemeral: true });
            } else {
                await interaction.followup({ embeds: [embedErro(res.err)], ephemeral: true });
            }
        }
        if (interaction.customId === 'modal_alvo') {
            const tid = interaction.fields.getTextInputValue('input_alvo').trim();
            if (isNaN(tid)) return interaction.reply({ embeds: [embedErro('ID inválido.')], ephemeral: true });
            CFG.target_id = tid;
            saveCfg();
            
            let target = null;
            if (STATE.selfbot) {
                try { target = await STATE.selfbot.users.fetch(tid); } catch(e){}
            }
            const e = new EmbedBuilder()
                .setTitle('🎯 Alvo definido')
                .setDescription(target ? `**${target.username}**` : `ID salvo: \`${tid}\``)
                .setColor(0x5865F2)
                .addFields({ name: 'ID', value: `\`${tid}\``, inline: true });
            await interaction.reply({ embeds: [e], ephemeral: true });
        }
    }
});

// Comando de texto para abrir o painel
control.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.content === '!painel') {
        const embed = new EmbedBuilder()
            .setTitle('🎛️ Painel Selfbot Cloner')
            .setDescription('Use os botões abaixo para controlar tudo:')
            .setColor(0x5865F2)
            .addFields(
                { name: '🔐 Login Selfbot', value: 'Insira o token da conta a clonar' },
                { name: '🎯 Definir Alvo', value: 'Informe o ID do usuário alvo' },
                { name: '📋 Clonar', value: 'Executa a clonagem' },
                { name: '📊 Status', value: 'Mostra o estado atual' },
                { name: '🚪 Sair', value: 'Desconecta o selfbot' }
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_login').setLabel('Login Selfbot').setStyle(ButtonStyle.Success).setEmoji('🔐'),
            new ButtonBuilder().setCustomId('btn_alvo').setLabel('Definir Alvo').setStyle(ButtonStyle.Primary).setEmoji('🎯'),
            new ButtonBuilder().setCustomId('btn_clonar').setLabel('Clonar').setStyle(ButtonStyle.Danger).setEmoji('📋'),
            new ButtonBuilder().setCustomId('btn_status').setLabel('Status').setStyle(ButtonStyle.Secondary).setEmoji('📊'),
            new ButtonBuilder().setCustomId('btn_sair').setLabel('Sair').setStyle(ButtonStyle.Secondary).setEmoji('🚪')
        );

        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

control.once(Events.ClientReady, async () => {
    console.log(`[PAINEL] Online como ${control.user.username} (${control.user.id})`);
    if (CFG.selfbot_token) {
        console.log('[PAINEL] Tentando auto-login do selfbot salvo...');
        const res = await startSelfbot(CFG.selfbot_token);
        if (!res.ok) console.log(`[PAINEL] Auto-login falhou: ${res.err}`);
    }
});

if (!BOT_TOKEN) {
    console.error('[ERRO] BOT_TOKEN ausente no .env');
    process.exit(1);
}

control.login(BOT_TOKEN);
