/**
 * Firebase Auth State Change Listener
 * This module sets up an auth state change listener to keep our app in sync with Firebase Auth
 */
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useAuthStore } from '../../store/authStore';
import { getCurrentUser } from './authService';
import { saveAuthToStorage, markUserAuthenticated } from '../../utils/sessionStorage';

let isInitialized = false;
// Track last state update timestamp to prevent frequent updates
let lastStateUpdateTime = 0;
// Track consecutive null users to detect initialization issues
let consecutiveNullUsers = 0;

/**
 * Initialize the auth state listener
 */
export const initAuthStateListener = () => {
  // CRITICAL: Check if reload loop has already been detected
  if (localStorage.getItem('reload-loop-detected') === 'true' || 
      localStorage.getItem('auth-loop-broken') === 'true') {
    console.error('🚨 Auth loop detected! Not initializing auth listener to break the cycle');
    return;
  }

  if (isInitialized) {
    console.log('🛑 Auth state listener already initialized - preventing duplicate listeners');
    return;
  }
  
  console.log('🔄 Initializing Firebase Auth state listener');
  
  // CRITICAL: Set up a watchdog that will disable the auth listener if it gets triggered too frequently
  let activeListenerCount = 0;
  const startTime = Date.now();
  
  // Create a watchdog interval that checks for excessive listener activity
  const watchdogInterval = setInterval(() => {
    const runTime = Date.now() - startTime;
    const callsPerSecond = activeListenerCount / (runTime / 1000);
    
    // If the listener is being called extremely frequently, we're likely in a loop
    if (activeListenerCount > 10 && callsPerSecond > 0.5) { // More than once every 2 seconds avg
      console.error(`🚨 Auth listener triggered ${activeListenerCount} times in ${runTime}ms - disabling to break loop`);
      localStorage.setItem('auth-loop-broken', 'true');
      localStorage.setItem('reload-loop-detected', 'true');
      clearInterval(watchdogInterval);
      
      // Force redirect to login page after short delay
      if (!window.location.pathname.includes('/login')) {
        setTimeout(() => {
          window.location.href = '/login';
        }, 500);
      }
    }
  }, 5000); // Check every 5 seconds
  
  // Listen for auth state changes
  onAuthStateChanged(auth, async (firebaseUser) => {
    // Increment the counter every time the listener is called
    activeListenerCount++;
    
    // Check if reload loop detection has triggered while we were running
    if (localStorage.getItem('reload-loop-detected') === 'true' || 
        localStorage.getItem('auth-loop-broken') === 'true') {
      console.error('🚨 Auth loop detected during listener execution! Exiting callback');
      return;
    }
  
    // Track auth state change frequency to prevent loops
    const now = Date.now();
    const timeSinceLastUpdate = now - lastStateUpdateTime;
    
    // If updates are happening too frequently (less than 1 second apart), might be a loop
    if (timeSinceLastUpdate < 1000) {
      console.warn(`⚠️ Rapid auth state changes detected (${timeSinceLastUpdate}ms) - possible loop!`);
      
      // Store loop detection data
      const loopCount = parseInt(sessionStorage.getItem('auth-loop-count') || '0', 10);
      sessionStorage.setItem('auth-loop-count', (loopCount + 1).toString());
      
      // Break out of potential loops if they occur too many times
      if (loopCount > 3) { // Lower threshold (was 5)
        console.error('🛑 Auth state change loop detected - breaking out');
        localStorage.setItem('auth-loop-broken', 'true');
        
        // Stop processing this callback to break the loop
        return;
      }
    } else {
      // Reset loop counter when updates are properly spaced
      sessionStorage.setItem('auth-loop-count', '0');
    }
    
    // Update the last state change timestamp
    lastStateUpdateTime = now;
    
    // Flag to determine if this is right after a page load
    const isPageLoad = performance.now() < 3000; // Within 3 seconds of page load
    
    // Debug log but avoid excessive logging
    console.log(`🔐 Firebase Auth State Changed:`, 
      firebaseUser 
        ? `User Authenticated (${firebaseUser.uid})${isPageLoad ? ' - during page load' : ''}`
        : `User Signed Out${isPageLoad ? ' - during page load' : ''}`
    );

    if (firebaseUser) {
      // Reset null user counter when we have a valid user
      consecutiveNullUsers = 0;
      
      try {
        // User is signed in - but throttle the updates to prevent loops
        // Check if we've updated auth state recently
        const lastUpdate = parseInt(sessionStorage.getItem('last-auth-update-time') || '0', 10);
        const timeSinceLastFullUpdate = now - lastUpdate;
        
        // Don't update auth state more than once every 2 seconds unless forced
        if (timeSinceLastFullUpdate < 2000 && !isPageLoad) {
          console.log('🛑 Throttling auth state update - too frequent');
          return;
        }
        
        // Get current store state
        const { isAuthenticated, user: existingUser } = useAuthStore.getState();
          // If we're already authenticated with the same user, avoid unnecessary updates
        if (isAuthenticated && existingUser && existingUser.id === firebaseUser.uid) {
          console.log('✅ Already authenticated with same user - skipping redundant update');
          return;
        }
        
        // User is signed in - get user data
        const user = await getCurrentUser();
        if (user) {
          console.log('✅ Auth listener found valid user, updating state');
          
          // Get token
          const token = await firebaseUser.getIdToken(true);
          
          // Update store
          useAuthStore.setState({ 
            user, 
            token, 
            isAuthenticated: true,
            error: null
          });
          
          // Also update our persistent auth storage
          const { savePersistentAuth } = await import('./persistentAuth');
          await savePersistentAuth(user);
          
          // And update session storage
          saveAuthToStorage(user, token);
          
          // Mark that the user has authenticated in this session
          markUserAuthenticated();
          
          // Update last auth update timestamp
          sessionStorage.setItem('last-auth-update-time', now.toString());
        } else {
          console.warn('⚠️ Firebase user exists but couldn\'t get user data');
        }
      } catch (error) {
        console.error('Error handling auth state change:', error);
      }
    } else {
      // Count consecutive null users to detect initialization issues
      consecutiveNullUsers++;
      
      // IMPORTANT: For page loads, we need to be very careful with null users
      // Firebase often returns null initially during page load before it initializes
      if (isPageLoad || consecutiveNullUsers <= 2) {
        console.log(`⚠️ Null user ${consecutiveNullUsers > 1 ? `(${consecutiveNullUsers} consecutive)` : ''} - likely just initialization, not logging out`);
        // Don't clear auth state during initial load - it might just be Firebase initializing
        return;
      }
      
      // Don't immediately clear auth state on null user - this often happens during page reloads
      // before Firebase has fully initialized. Instead, check current app state.
      const { isAuthenticated } = useAuthStore.getState();
      const isLoginPage = window.location.pathname === '/login';
      const isLoggingOut = localStorage.getItem('logging-out') === 'true';
      const isManualReload = sessionStorage.getItem('manual-reload') === 'true';
      
      // During manual reload, don't clear auth
      if (isManualReload) {
        console.log('🔄 Manual reload detected - preserving auth state');
        sessionStorage.removeItem('manual-reload');
        return;
      }      // Check if we should throttle logout events
      const lastLogoutTime = parseInt(sessionStorage.getItem('last-logout-time') || '0', 10);
      const timeSinceLastLogout = now - lastLogoutTime;
      
      // Throttle logout events (prevents rapid state changes that can cause loops)
      if (timeSinceLastLogout < 5000) { // 5 seconds
        console.log('🛑 Throttling logout - too soon after last logout');
        return;
      }
      
      if (isLoggingOut) {
        // If we're explicitly logging out, clear auth
        console.log('🔑 Explicit logout detected, clearing auth state');
        useAuthStore.setState({ user: null, token: null, isAuthenticated: false, error: null });
        localStorage.removeItem('logging-out');
        sessionStorage.setItem('last-logout-time', now.toString());
      } else if (isAuthenticated && isLoginPage) {
        // If we're authenticated but on the login page, clear auth
        console.log('🔑 On login page while authenticated, clearing auth state');
        useAuthStore.setState({ user: null, token: null, isAuthenticated: false, error: null });
        sessionStorage.setItem('last-logout-time', now.toString());
      } else if (!isAuthenticated) {
        // If we're already signed out according to our store, no action needed
        console.log('🔒 Already signed out in store, no action needed');
        // DON'T update state here - prevents unnecessary re-renders
      } else {
        // Firebase says no user but we think we're authenticated - this is ambiguous
        // during page reload, we should check persistent storage without clearing state
        console.log('⚠️ Ambiguous auth state - checking persistent storage');
        
        // Don't check persistent auth too frequently 
        const lastPersistentCheck = parseInt(sessionStorage.getItem('last-persistent-check') || '0', 10);
        if (now - lastPersistentCheck < 3000) { // 3 seconds
          console.log('🛑 Throttling persistent auth check - checked recently');
          return;
        }
        
        sessionStorage.setItem('last-persistent-check', now.toString());
        
        setTimeout(async () => {
          try {
            const { hasPersistentAuth, restorePersistentAuth } = await import('./persistentAuth');
            if (hasPersistentAuth()) {
              console.log('🔍 Found persistent auth during ambiguous state - trying to restore');
              const restored = await restorePersistentAuth();
              // NEVER clear auth state during page load, even if restore fails
              // This prevents the infinite reload cycles that happen during initialization
              if (!restored && !isPageLoad && consecutiveNullUsers > 3) {
                console.log('❌ Failed to restore auth and multiple null users - clearing auth state');
                useAuthStore.setState({ user: null, token: null, isAuthenticated: false, error: null });
                sessionStorage.setItem('last-logout-time', now.toString());
              }
            } else if (!isPageLoad && consecutiveNullUsers > 3) {
              // Only clear if not during page load AND we've had several consecutive null users
              console.log('❌ No persistent auth found and multiple null users - clearing auth state');
              useAuthStore.setState({ user: null, token: null, isAuthenticated: false, error: null });
              sessionStorage.setItem('last-logout-time', now.toString());
            }
          } catch (e) {
            console.error('Error resolving ambiguous auth state:', e);
          }
        }, 100);
      }
    }
  });

  // Mark that the listener is initialized to prevent duplicate listeners
  isInitialized = true;
  console.log('✅ Auth state listener successfully initialized');
};
