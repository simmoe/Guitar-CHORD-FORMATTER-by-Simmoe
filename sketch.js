let currentPage = 1
let pages

// Regex pattern for flexible chord detection (Root + Modifier + Bass)
// Modifier includes common chord symbols but excludes characters likely to be in normal words (e.g. h, k, r, v, w, etc.)
const chordPattern = "[A-G][#b]?([majsudigotb0-9#\\+\\-\\(\\)\\^∆°ø]*)(/[A-G][#b]?)?";

function setup() {
    noCanvas();
    pages = selectAll('.page');
    
    // Hent elementer fra HTML
    let inputArea = select('#inputArea');
    let formatButton = select('#formatButton');
    let outputDiv = select('#outputDiv').addClass('scrollable').attribute('tabindex', '0');
    let backButton = select('#backButton');
    let copyButton = select('#copyButton');

    // Når outputDiv klikkes, toggler vi full-screen klassen
    outputDiv.mouseClicked(() => {
        outputDiv.toggleClass('full-screen');
    });
    
    // Event listeners
    formatButton.mousePressed(() => {
        formatLyrics(inputArea, outputDiv);
        shiftPage(2);
    });
    
    copyButton.mousePressed(() => {
        copyToClipboard(outputDiv, copyButton);
    });
            
    backButton.mousePressed(() => {
        inputArea.value('')
        outputDiv.html('')
        shiftPage(1);
    });

    // Start med fokus på input
    inputArea.elt.focus();
}


function formatLyrics(inputArea, outputDiv) {
    let inputText = inputArea.value();
    
    // Smart formatting: 
    // 1. Trim leading/trailing whitespace
    inputText = inputText.trim();
    // 2. Collapse 3 or more newlines into 2 (leaving 1 empty line in between)
    // Matches 2 or more empty lines (which is 3 or more newlines) and replaces with 2 newlines
    inputText = inputText.replace(/\n\s*\n\s*\n/g, '\n\n'); 
    // Also handle just 2 newlines if valid, but we really want to prevent *excessive* space.
    // The user said "No double empty rows".
    // 1 empty row = \n\n. 2 empty rows = \n\n\n.
    // Let's replace 3+ \n with 2 \n.
    inputText = inputText.replace(/(\n\s*){3,}/g, '\n\n');

    let lines = inputText.split('\n')
    let gridItems = []

    let p = 'not-chords'

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i]
        let lyricsCell = ''
        let rhythmCell = ''

        if(line.includes('--')){
            lyricsCell = line
            rhythmCell = ''
            p = 'not-chords'
        }
        else if(isSectionHeader(line)){
            // Replace brackets and trim
            let cleanLine = line.replace(/[\[\]]/g, '').trim(); 
            lyricsCell = formatSectionHeader(cleanLine)
            rhythmCell = lyricsCell // Repeat logic for right side as well
            p = 'not-chords'
        }
        else if (isPipeChordLine(line)) {
            // Check if the next non-empty line is lyrics (not chords, not header)
            let nextIdx = i + 1;
            while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
            let nextLine = nextIdx < lines.length ? lines[nextIdx] : '';
            let nextIsLyrics = nextLine.trim() !== '' 
                && !isSectionHeader(nextLine) 
                && !isPipeChordLine(nextLine)
                && !new RegExp(`^${chordPattern},?(\\s+${chordPattern},?)*$`).test(nextLine.trim());
            
            if (nextIsLyrics) {
                // Treat as chord line for the upcoming lyric line
                p = 'chords'
                continue
            } else {
                // Standalone pipe chord line (e.g. intro)
                lyricsCell = line.trim()
                rhythmCell = extractRhythmPattern(line)
                p = 'not-chords'
            }
        }
        else if (new RegExp(`^${chordPattern},?(\\s+${chordPattern},?)*$`).test(line.trim())) {
            p = 'chords'
            continue
        } 
        else if (line.trim() != '') {
            if(p == 'chords'){
                lyricsCell = formatChordTextPair(lines[i-1], line)
                rhythmCell = extractRhythmPattern(lines[i-1])
                p = "not-chords"
            } else {
                lyricsCell = line
                rhythmCell = ''
            }
        } 
        else {
            lyricsCell = ' '
            rhythmCell = ''
            p = "not-chords"
            // Skip empty rows completely
            continue;
        }

        gridItems.push(`<div class="lyrics-cell">${lyricsCell}</div>`)
        gridItems.push(`<div class="rhythm-cell">${rhythmCell}</div>`)
    }
    
    let htmlOutput = `<div class="chord-grid">${gridItems.join('')}</div>`
    outputDiv.html(htmlOutput);
}

function extractRhythmPattern(chordLine) {
    let chordsWithPos = [];
    let regex = new RegExp(`(${chordPattern})`, 'g');
    let match;
    
    while ((match = regex.exec(chordLine)) !== null) {
        let fullChord = match[0];
        let tone = fullChord;
        
        // Find bastone eller rod
        if (fullChord.includes('/')) {
                tone = fullChord.split('/')[1];
        } else {
                let rootMatch = fullChord.match(/^[A-G][#b]?/);
                if (rootMatch) tone = rootMatch[0];
        }
        let label = `<b style="display:inline-block;min-width:2em;text-align:center;">${tone}</b>`;
        chordsWithPos.push({ label, pos: match.index });
    }
    
    if (chordsWithPos.length === 0) return '';
    
    let barsPerLine = parseInt(select('#barsPerLine').value()) || 4;
    
    // Fordel akkorder i takter baseret på deres position i linjen
    let lineLen = Math.max(chordLine.length, 1);
    let barWidth = lineLen / barsPerLine;
    
    // Opret takter (bars) som arrays
    let bars = [];
    for (let b = 0; b < barsPerLine; b++) bars.push([]);
    
    for (let c of chordsWithPos) {
        let barIndex = Math.min(Math.floor(c.pos / barWidth), barsPerLine - 1);
        bars[barIndex].push(c.label);
    }
    
    // Fyld tomme takter med den senest kendte akkord
    let lastChord = bars[0].length > 0 ? bars[0][bars[0].length - 1] : chordsWithPos[0].label;
    for (let b = 0; b < bars.length; b++) {
        if (bars[b].length === 0) {
            bars[b].push(lastChord);
        } else {
            lastChord = bars[b][bars[b].length - 1];
        }
    }
    
    // Formater: akkorder i samme takt adskilles med mellemrum, takter adskilles med |
    return bars.map(bar => bar.join(' ')).join(' | ');
}


function formatChordTextPair(chordLine, lyricLine) {
    let formattedLine = '';
    let startCoords = 0;
    let trailingChordCount = 0;

    // Regex to find chords
    let regex = new RegExp(`(${chordPattern},?)`, 'g');
    let match;
    let matches = [];
    while ((match = regex.exec(chordLine)) !== null) {
        matches.push(match);
    }

    if (matches.length === 0) return lyricLine;

    for (let i = 0; i < matches.length; i++) {
        let match = matches[i];
        let chord = match[0];
        let chordIndex = match.index;

        // Use absolute index from chord line
        let insertPos = chordIndex;

        // "Intelligent" adjustments:
        // 1. If the chord lands on a space, try to snap it to the start of the next word 
        if (insertPos < lyricLine.length && lyricLine[insertPos] === ' ') {
            let nextWordIdx = -1;
            for(let k = insertPos; k < lyricLine.length; k++){
                if(lyricLine[k] !== ' '){
                    nextWordIdx = k;
                    break;
                }
            }
            // If next word is reasonably close (e.g. within 5 chars), snap to it.
            if(nextWordIdx !== -1 && (nextWordIdx - insertPos) < 5) {
                insertPos = nextWordIdx;
            }
        }
        
        // 2. If the chord lands INSIDE a short word (likely a single syllable), snap to start.
        if (insertPos > 0 && insertPos < lyricLine.length && 
            lyricLine[insertPos] !== ' ' && lyricLine[insertPos-1] !== ' ') {
             
             let wStart = insertPos;
             while(wStart > 0 && lyricLine[wStart-1] !== ' ') {
                 wStart--;
             }
             let wEnd = insertPos;
             while(wEnd < lyricLine.length && lyricLine[wEnd] !== ' ') {
                 wEnd++;
             }
             
             // If word is short (e.g. <= 6 chars), snap to start
             if ((wEnd - wStart) <= 6) {
                 insertPos = wStart;
             }
        }
        
        // If we picked an insertion point earlier than processed text, clamp it
        if (insertPos < startCoords) insertPos = startCoords;

        if (insertPos >= lyricLine.length) {
            // Finalize text if not done
            if(startCoords < lyricLine.length){
                formattedLine += lyricLine.substring(startCoords);
                startCoords = lyricLine.length;
            }
            
            // Format trailing chords
            if (trailingChordCount > 0) {
                 formattedLine += `<sup>| ${chord}</sup> `;
            } else {
                 let padding = (formattedLine.length > 0 && !formattedLine.endsWith(' ')) ? ' ' : '';
                 formattedLine += padding + `<sup class='chord'>${chord}</sup> `;
            }
            trailingChordCount++;
            continue;
        }

        // Insert text up to chord position
        if (insertPos > startCoords) {
             formattedLine += lyricLine.substring(startCoords, insertPos);
        }
        
        // Insert chord
        formattedLine += `<sup class='chord'>${chord}</sup>`;
        startCoords = insertPos;
    }

    // Append remaining text
    if (startCoords < lyricLine.length) {
        formattedLine += lyricLine.substring(startCoords);
    }
    
    return formattedLine;
}




function shiftPage(num) {
    if(num == "ArrowLeft"){
        num = currentPage - 1;
    }
    if(num == "ArrowRight"){
        num = currentPage + 1;
    }

    if(isNaN(num) || num > pages.length || num == 0){
        return;
    }
    select("#page" + currentPage).removeClass('visible');
    currentPage = num;
    select("#page" + currentPage).addClass('visible');

    // Sæt fokus på det relevante element (input eller output) når siden skifter
    // Vi bruger en lille timeout, så slide-animationen er færdig først
    setTimeout(() => {
        if(currentPage === 1) {
            select('#inputArea').elt.focus();
        } else if (currentPage === 2) {
            select('#outputDiv').elt.focus();
        }
    }, 350);
}


function copyToClipboard(outputDiv, button) {
    // Generate simple two-column layout (no table) for easy editing in Google Docs
    let lyricsCells = outputDiv.elt.querySelectorAll('.lyrics-cell');
    let rhythmCells = outputDiv.elt.querySelectorAll('.rhythm-cell');
    
    // Use a full-width borderless table — only way to get right-alignment in Google Docs
    let tableHTML = '<table style="width: 100%; border: none; border-collapse: collapse; font-family: sans-serif;">';
    
    for(let i = 0; i < lyricsCells.length; i++) {
        let lContent = lyricsCells[i].innerHTML;
        let rContent = rhythmCells[i] ? rhythmCells[i].innerHTML : '';
        
        // Make sup tags compact
        lContent = lContent.replace(/<sup/g, '<sup style="line-height: 0; vertical-align: super;"');

        tableHTML += '<tr>';
        tableHTML += `<td style="border: none; padding: 0; white-space: nowrap;">${lContent}</td>`;
        tableHTML += `<td style="border: none; padding: 0; text-align: right; white-space: nowrap; width: 1px;">${rContent}</td>`;
        tableHTML += '</tr>';
    }
    tableHTML += '</table>';

    // Helper to show visual feedback on the button
    const showSuccess = () => {
        if(button) {
            let originalText = button.html();
            button.html("Kopieret!");
            setTimeout(() => button.html(originalText), 2000);
        }
    };

    // Use Blob and ClipboardItem for rich text copy
    try {
        const blobHtml = new Blob([tableHTML], { type: "text/html" });
        const blobText = new Blob([outputDiv.elt.innerText], { type: "text/plain" });
        const data = [new ClipboardItem({ 
            "text/html": blobHtml,
            "text/plain": blobText 
        })];

        navigator.clipboard.write(data).then(function() {
            showSuccess();
        }, function(err) {
            console.error("Kunne ikke kopiere: ", err);
            fallbackCopy(outputDiv.elt.innerText);
        });
    } catch (e) {
        // Fallback for browsers that don't support ClipboardItem (e.g. Firefox default config sometimes)
        console.error("ClipboardItem error, trying fallback listener", e);
        
        // Listener-based fallback
        function listener(e) {
            e.clipboardData.setData("text/html", tableHTML);
            e.clipboardData.setData("text/plain", outputDiv.elt.innerText);
            e.preventDefault();
        }
        document.addEventListener("copy", listener);
        document.execCommand("copy");
        document.removeEventListener("copy", listener);
        showSuccess();
    }
}
    

// Fallback til ældre browsere
function fallbackCopy(text) {
    let textArea = document.createElement("textarea")
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()
    document.execCommand("copy")
    document.body.removeChild(textArea)
}

function isSectionHeader(line) {
    const l = line.trim().toLowerCase();
    if (l.length > 50) return false; 
    return l.startsWith('[') || 
           l.includes('verse') || 
           l.includes('vers') || 
           l.includes('chorus') || 
           l.includes('omkvæd') || 
           l.includes('bridge') || 
           l.includes('c-stykke') ||
           l.includes('intro') ||
           l.includes('outro');
}

function isPipeChordLine(line) {
    // Matches lines like "| G# | G# | D# | D# |" — pipes with chords only
    let stripped = line.replace(/\|/g, '').trim();
    if (!stripped) return false;
    return line.includes('|') && new RegExp(`^${chordPattern}(\\s+${chordPattern})*$`).test(stripped);
}

function formatSectionHeader(text) {
    const t = text.trim().toLowerCase();
    let bg = '#eeeeee'; // default gray
    
    if (t.includes('verse') || t.includes('vers')) {
        bg = '#e8f5e9'; // Pale Green
    } else if (t.includes('chorus') || t.includes('omkvæd')) {
        bg = '#ffebee'; // Pale Red
    } else if (t.includes('bridge') || t.includes('c-stykke')) {
        bg = '#fff3e0'; // Pale Orange
    } else if (t.includes('intro')) {
        bg = '#e3f2fd'; // Pale Blue
    } else if (t.includes('outro')) {
        bg = '#f3e5f5'; // Pale Purple
    }
    
    // Compact style with background color
    return `<div style="background-color: ${bg}; padding: 5px 6px; border-radius: 4px; font-weight: bold; width: 100%; box-sizing: border-box; font-size: 0.9em;">${text}</div>`;
}
