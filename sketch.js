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
    let chords = [];
    // Find alle akkorder i linjen (ignorer eksisterende rør/pipes da vi selv formaterer)
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
        chords.push(`<b>${tone}</b>`);
    }
    
    // Join konsekvent med ' | ' for at angive "en takt pr. akkord" som standard
    return chords.join(' | ');
}


function formatChordTextPair(chordLine, lyricLine) {
    let formattedLine = '';
    let chordMatches = [];
    // Regex der matcher akkorder inkl. m7, add-typer, og et valgfrit komma
    let regex = new RegExp(`(${chordPattern},?)`, 'g');
    let match;
    
    while ((match = regex.exec(chordLine)) !== null) {
        chordMatches.push({ index: match.index, chord: match[0] });
    }
    
    let lastIndex = 0;
    let spaceOffset = 0; // Ekstra forskydning for korrekt placering
    let chordsAfterCount = 0; // Tæller akkorder efter lyricLine
    
    for (let i = 0; i < chordMatches.length; i++) {
        let { index, chord } = chordMatches[i];
        let spacesBefore = (chordLine.substring(lastIndex, index).match(/ /g) || []).length;
        let insertPos = lastIndex + spacesBefore + spaceOffset;
        if (insertPos > lyricLine.length) insertPos = lyricLine.length;
        
        if (insertPos === lyricLine.length) {
            // Akkorden skal indsættes efter lyricLine
            formattedLine += lyricLine.substring(lastIndex, insertPos);
            // Hvis det ikke er den første akkord efter teksten, tilføj taktmarkør inde i chord-elementet
            if (chordsAfterCount > 0) {
                formattedLine += `<sup>| ${chord}</sup> `;
            } else {
                formattedLine += `<sup class='chord'>${chord}</sup> `;
            }
            lastIndex = insertPos;
            chordsAfterCount++;
            spaceOffset += chord.length + 3;
        } else {
            // Akkorden indsættes midt i lyricLine – nulstil count for akkorder efter teksten
            chordsAfterCount = 0;
            // Juster indsætningspunktet, hvis det falder midt i et ord
            if (insertPos > 0 && insertPos < lyricLine.length &&
                lyricLine[insertPos - 1] !== ' ' && lyricLine[insertPos] !== ' ') {
                let leftPos = insertPos;
                while (leftPos > 0 && lyricLine[leftPos - 1] !== ' ') {
                    leftPos--;
                }
                let rightPos = insertPos;
                while (rightPos < lyricLine.length && lyricLine[rightPos] !== ' ') {
                    rightPos++;
                }
                let distLeft = insertPos - leftPos;
                let distRight = rightPos - insertPos;
                insertPos = (distLeft <= distRight) ? leftPos : rightPos;
            }
            let padding = (formattedLine.endsWith('</sup>') ? ' ' : '');
            formattedLine += lyricLine.substring(lastIndex, insertPos) + padding + `<sup>${chord}</sup> `;
            lastIndex = insertPos;
            spaceOffset += chord.length + 3;
        }
    }
    
    formattedLine += lyricLine.substring(lastIndex);
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
    // Generate a temporary table for copying to preserve layout
    let lyricsCells = outputDiv.elt.querySelectorAll('.lyrics-cell');
    let rhythmCells = outputDiv.elt.querySelectorAll('.rhythm-cell');
    
    // Explicitly zero out border spacing and collapse borders
    // Try forcing width via HTML attribute and minimal CSS width to encourage shrink-to-fit behavior
    let tableHTML = '<table width="1" cellpadding="0" cellspacing="0" style="width: auto; border-collapse: collapse; border-spacing: 0; border: none; font-family: sans-serif;">';
    
    for(let i = 0; i < lyricsCells.length; i++) {
        let lContent = lyricsCells[i].innerHTML;
        let rContent = rhythmCells[i] ? rhythmCells[i].innerHTML : '';
        
        // Make sup tags compact to avoid expanding line height but keep font size normal
        lContent = lContent.replace(/<sup/g, '<sup style="line-height: 0; vertical-align: super;"');

        tableHTML += '<tr>';
        // Left column: Lyrics and chords. width: 1% forces cell to shrink to content width
        tableHTML += `<td style="width: 1%; vertical-align: bottom; padding: 0; line-height: 1; border: none; white-space: nowrap;">${lContent}</td>`;
        // Right column: Bass rhythm. width: 1% forces cell to shrink to content width
        tableHTML += `<td style="width: 1%; vertical-align: bottom; text-align: right; line-height: 1; white-space: nowrap; padding: 0; border: none;">${rContent}</td>`;
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
