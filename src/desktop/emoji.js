// A compact offline collection, deliberately independent of network services.
// Entries: [text, keywords, category].
export const CATEGORIES = [
    ['smileys', 'Smileys', 'emoji-people-symbolic'],
    ['gestures', 'People', 'emoji-body-symbolic'],
    ['hearts', 'Hearts', 'emote-love-symbolic'],
    ['nature', 'Nature', 'emoji-nature-symbolic'],
    ['food', 'Food', 'emoji-food-symbolic'],
    ['activities', 'Activities', 'emoji-activities-symbolic'],
    ['travel', 'Travel', 'emoji-travel-symbolic'],
    ['objects', 'Objects', 'emoji-objects-symbolic'],
    ['symbols', 'Symbols', 'emoji-symbols-symbolic'],
    ['kaomoji', 'Kaomoji', 'face-smile-big-symbolic'],
];

const groups = {
    smileys: [
        ['😀', 'smile happy face'], ['😃', 'grin happy'], ['😄', 'smile eyes happy'], ['😁', 'beaming grin'],
        ['😆', 'laughing squint'], ['😂', 'laugh tears joy'], ['🤣', 'rolling laugh'], ['😊', 'blush smile'],
        ['😇', 'angel halo innocent'], ['🙂', 'slight smile'], ['🙃', 'upside down'], ['😉', 'wink'],
        ['😌', 'relieved calm'], ['🥰', 'love smile'], ['😍', 'heart eyes'], ['🤩', 'star eyes'],
        ['😘', 'kiss'], ['😋', 'yum tasty'], ['😛', 'tongue'], ['😜', 'wink tongue silly'],
        ['🤪', 'zany crazy'], ['🤓', 'nerd glasses'], ['😎', 'cool sunglasses'], ['🥳', 'party'],
        ['🤗', 'hug'], ['🤔', 'thinking'], ['🤨', 'raised eyebrow skeptical'], ['😐', 'neutral'],
        ['😑', 'expressionless'], ['😶', 'no mouth silent'], ['🙄', 'eye roll'], ['😏', 'smirk'],
        ['😬', 'grimace awkward'], ['😴', 'sleep tired'], ['🤤', 'drool'], ['😪', 'sleepy'],
        ['😷', 'mask sick'], ['🤒', 'fever thermometer sick'], ['🤯', 'mind blown exploding'],
        ['🥱', 'yawn bored'], ['😕', 'confused'], ['😟', 'worried'], ['🙁', 'frown'],
        ['😮', 'open mouth surprised'], ['😲', 'astonished shocked'], ['🥺', 'pleading puppy eyes'],
        ['😢', 'sad cry'], ['😭', 'cry tears'], ['😱', 'scream fear'], ['😤', 'triumph huff'],
        ['😡', 'angry rage'], ['🤬', 'cursing swearing'], ['😅', 'sweat relief'], ['😈', 'devil smiling'],
        ['💀', 'skull dead'], ['👻', 'ghost'], ['🤖', 'robot'], ['👽', 'alien'], ['💩', 'poop'],
    ],
    gestures: [
        ['👍', 'thumbs up yes'], ['👎', 'thumbs down no'], ['👏', 'clap applause'], ['🙌', 'celebrate hands'],
        ['🙏', 'thanks pray'], ['👋', 'wave hello'], ['👌', 'okay hand'], ['✌️', 'victory peace'],
        ['🤞', 'fingers crossed luck'], ['🤟', 'love you gesture'], ['🤘', 'rock horns'], ['🤙', 'call me'],
        ['👉', 'point right'], ['👈', 'point left'], ['👆', 'point up'], ['👇', 'point down'],
        ['☝️', 'index up'], ['✋', 'raised hand stop'], ['🤚', 'raised back hand'], ['🖐️', 'hand fingers'],
        ['✊', 'raised fist'], ['👊', 'fist bump'], ['🤝', 'handshake deal'], ['💪', 'strong muscle'],
        ['🫶', 'heart hands'], ['✍️', 'writing'], ['👀', 'eyes look'], ['🧠', 'brain smart'],
        ['🙋', 'raising hand'], ['🤷', 'shrug'], ['🤦', 'facepalm'], ['🙇', 'bow'],
        ['🧑‍💻', 'developer technologist coder'], ['👨‍🍳', 'cook chef'], ['🧑‍🎨', 'artist painter'],
    ],
    hearts: [
        ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'],
        ['💙', 'blue heart'], ['💜', 'purple heart'], ['🖤', 'black heart'], ['🤍', 'white heart'],
        ['🤎', 'brown heart'], ['💔', 'broken heart'], ['❣️', 'heart exclamation'], ['💕', 'two hearts'],
        ['💞', 'revolving hearts'], ['💓', 'beating heart'], ['💗', 'growing heart'], ['💖', 'sparkling heart'],
        ['💘', 'heart arrow cupid'], ['💝', 'heart ribbon gift'], ['💌', 'love letter'], ['💋', 'kiss mark'],
    ],
    nature: [
        ['🐱', 'cat'], ['🐶', 'dog'], ['🦊', 'fox'], ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'],
        ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'], ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey'],
        ['🐔', 'chicken'], ['🐧', 'penguin linux'], ['🐦', 'bird'], ['🦉', 'owl'], ['🦋', 'butterfly'],
        ['🐝', 'bee honey'], ['🐢', 'turtle slow'], ['🐍', 'snake python'], ['🐙', 'octopus'],
        ['🐳', 'whale'], ['🐬', 'dolphin'], ['🦄', 'unicorn'], ['🌸', 'flower cherry'], ['🌹', 'rose'],
        ['🌻', 'sunflower'], ['🌷', 'tulip'], ['🌱', 'seedling plant'], ['🌳', 'tree'], ['🌴', 'palm tree'],
        ['🍀', 'clover luck'], ['🍁', 'maple leaf autumn'], ['🌵', 'cactus'], ['☀️', 'sun sunny'],
        ['🌙', 'moon night'], ['⭐', 'star'], ['🌈', 'rainbow'], ['⛅', 'cloud sun'], ['🌧️', 'rain'],
        ['⛈️', 'storm thunder'], ['❄️', 'snowflake cold'], ['🔥', 'fire'], ['💧', 'droplet water'],
        ['🌊', 'wave ocean'], ['🌍', 'earth world'],
    ],
    food: [
        ['🍎', 'apple'], ['🍊', 'orange'], ['🍋', 'lemon'], ['🍌', 'banana'], ['🍉', 'watermelon'],
        ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🍒', 'cherries'], ['🍑', 'peach'], ['🥭', 'mango'],
        ['🍍', 'pineapple'], ['🥑', 'avocado'], ['🍅', 'tomato'], ['🌶️', 'pepper hot spicy'],
        ['🌽', 'corn'], ['🥕', 'carrot'], ['🍞', 'bread'], ['🧀', 'cheese'], ['🍳', 'egg cooking'],
        ['🍔', 'burger'], ['🍟', 'fries'], ['🍕', 'pizza'], ['🌮', 'taco'], ['🍜', 'noodles ramen'],
        ['🍣', 'sushi'], ['🍚', 'rice'], ['🍛', 'curry'], ['🍰', 'cake'], ['🎂', 'birthday cake'],
        ['🍩', 'donut'], ['🍪', 'cookie'], ['🍫', 'chocolate'], ['🍿', 'popcorn'], ['☕', 'coffee tea'],
        ['🍵', 'tea green'], ['🧋', 'bubble tea boba'], ['🥤', 'soda drink'], ['🍺', 'beer'], ['🍷', 'wine'],
    ],
    activities: [
        ['🎉', 'party celebration'], ['🎊', 'confetti'], ['🎁', 'gift present'], ['🎈', 'balloon'],
        ['🎄', 'christmas tree'], ['🎃', 'pumpkin halloween'], ['🏆', 'trophy winner'], ['🥇', 'gold medal first'],
        ['⚽', 'soccer football'], ['🏀', 'basketball'], ['🏏', 'cricket'], ['🎾', 'tennis'],
        ['🎮', 'video game controller'], ['🎲', 'dice game'], ['♟️', 'chess'], ['🎯', 'target bullseye'],
        ['🎵', 'music'], ['🎶', 'notes music'], ['🎧', 'headphones music'], ['🎤', 'microphone sing'],
        ['🎸', 'guitar'], ['🎹', 'piano keyboard'], ['🎬', 'movie clapper'], ['🎨', 'art palette'],
        ['📸', 'camera flash photo'],
    ],
    travel: [
        ['🚀', 'rocket launch'], ['✈️', 'airplane flight'], ['🚗', 'car'], ['🚕', 'taxi'], ['🚌', 'bus'],
        ['🚆', 'train'], ['🚲', 'bicycle bike'], ['🛵', 'scooter'], ['⛵', 'sailboat'], ['🚢', 'ship'],
        ['🏠', 'house home'], ['🏢', 'office building'], ['🏫', 'school'], ['🏥', 'hospital'],
        ['🏖️', 'beach'], ['⛰️', 'mountain'], ['🏕️', 'camping'], ['🗺️', 'map'], ['🧭', 'compass'],
        ['🌆', 'city dusk'], ['🌃', 'night city'], ['🗽', 'statue liberty'],
    ],
    objects: [
        ['💻', 'computer laptop'], ['🖥️', 'desktop monitor'], ['⌨️', 'keyboard'], ['🖱️', 'mouse'],
        ['📱', 'phone mobile'], ['🔋', 'battery'], ['🔌', 'plug power'], ['💡', 'idea light'],
        ['🔦', 'flashlight'], ['📷', 'camera'], ['📺', 'television tv'], ['⏰', 'alarm clock'],
        ['⌛', 'hourglass time'], ['📅', 'calendar date'], ['📌', 'pin pushpin'], ['📎', 'paperclip'],
        ['✏️', 'pencil'], ['📝', 'memo note'], ['📚', 'books study'], ['📖', 'book open read'],
        ['📦', 'package box'], ['✉️', 'envelope mail'], ['📧', 'email'], ['🔑', 'key'], ['🔒', 'lock locked'],
        ['🔓', 'unlocked'], ['🛠️', 'tools'], ['⚙️', 'gear settings'], ['🧪', 'test tube lab'],
        ['🔭', 'telescope'], ['💊', 'pill medicine'], ['💰', 'money bag'], ['💳', 'credit card'],
        ['🛒', 'shopping cart'], ['🎒', 'backpack'], ['☂️', 'umbrella'], ['👓', 'glasses'],
    ],
    symbols: [
        ['✅', 'check done'], ['❌', 'cross cancel'], ['⚠️', 'warning'], ['❗', 'exclamation'],
        ['❓', 'question'], ['💯', 'hundred perfect'], ['✨', 'sparkles'], ['💫', 'dizzy'],
        ['💥', 'boom collision'], ['💬', 'speech bubble chat'], ['🔔', 'bell notification'], ['🚫', 'prohibited no'],
        ['♻️', 'recycle'], ['🔴', 'red circle'], ['🟢', 'green circle'], ['🔵', 'blue circle'],
        ['→', 'right arrow symbol'], ['←', 'left arrow symbol'], ['↑', 'up arrow symbol'], ['↓', 'down arrow symbol'],
        ['✓', 'check symbol'], ['★', 'star symbol'], ['∞', 'infinity symbol'], ['©', 'copyright symbol'],
        ['®', 'registered symbol'], ['™', 'trademark symbol'], ['°', 'degree symbol'], ['±', 'plus minus symbol'],
        ['×', 'multiply symbol'], ['÷', 'divide symbol'], ['≈', 'approximately symbol'], ['≠', 'not equal symbol'],
        ['€', 'euro currency symbol'], ['£', 'pound currency symbol'], ['¥', 'yen currency symbol'],
        ['৳', 'taka currency symbol'], ['•', 'bullet symbol'], ['…', 'ellipsis symbol'], ['—', 'em dash symbol'],
    ],
    kaomoji: [
        ['¯\\_(ツ)_/¯', 'shrug kaomoji'], ['(╯°□°）╯︵ ┻━┻', 'table flip kaomoji'],
        ['┬─┬ノ( º _ ºノ)', 'table restore calm kaomoji'], ['(づ｡◕‿‿◕｡)づ', 'hug kaomoji'],
        ['(•‿•)', 'smile kaomoji'], ['ಠ_ಠ', 'disapproval kaomoji'], ['(ง •̀_•́)ง', 'fight kaomoji'],
        ['(ᵔᴥᵔ)', 'bear kaomoji'], ['(=^･ω･^=)', 'cat kaomoji'], ['ʕ•ᴥ•ʔ', 'koala bear cute kaomoji'],
        ['(✿◠‿◠)', 'flower smile kaomoji'], ['(⌐■_■)', 'cool deal kaomoji'], ['(｡•́︿•̀｡)', 'sad pout kaomoji'],
        ['ヽ(•‿•)ノ', 'cheer yay kaomoji'], ['(￣▽￣)ノ', 'wave hello kaomoji'], ['(^_^;)', 'nervous sweat kaomoji'],
    ],
};

export const EMOJI = Object.entries(groups).flatMap(([category, entries]) =>
    entries.map(([text, keywords]) => [text, keywords, category]));

export function searchEmoji(query, recent = [], category = null) {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = EMOJI.filter(([text, keywords, group]) => (!category || group === category) &&
        words.every(word => `${text} ${keywords}`.includes(word)));
    return matches.sort(([a], [b]) => {
        const ai = recent.indexOf(a);
        const bi = recent.indexOf(b);
        return (ai < 0 ? 1000 : ai) - (bi < 0 ? 1000 : bi);
    });
}

export function addRecent(recent, text) {
    return [text, ...recent.filter(item => item !== text)].filter(item => EMOJI.some(([emoji]) => emoji === item)).slice(0, 20);
}
