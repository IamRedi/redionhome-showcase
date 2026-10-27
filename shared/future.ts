// Public product contracts. Documents and optional photo suggestions are M3 runtime features.
export type ObjectDocument = {
    id: string;
    mediaId: string;
    title: string;
    mime: 'application/pdf' | 'text/plain';
    visibility: 'private' | 'invited' | 'public';
};
export type PhotoSuggestionRequest = {
    objectId?: string;
    photoMediaId: string;
    expectedRevision: number;
    consent: true;
};
export type PhotoSuggestion = {
    id: string;
    basedOnMediaId: string;
    name: string;
    category: string;
    description: string;
    status: 'proposed';
    provider: string;
};
export type ConfirmPhotoSuggestion = {
    suggestionId: string;
    expectedRevision: number;
    confirmed: true;
    corrected: {
        name: string;
        category: string;
        description: string;
    };
};
// Confirmation must call the ordinary versioned object save and retain provenance.
export type FutureModule = {
    id: 'smart-fridge' | 'photo-comparison' | 'shopping-list' | 'storage' | 'inventory-search' | 'printer-monitoring' | 'routines' | 'automation' | 'hugo' | 'multi-home';
    status: 'planned';
};
