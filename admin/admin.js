// ========================================
// TN WARRIORS ADMIN SYSTEM
// Supabase Authentication + Admin Check
// ========================================


// Supabase Project
const SUPABASE_URL = "https://nwipyqarobgelksdbkbk.supabase.co";

// IMPORTANT:
// இங்கே உன் Supabase Publishable Key-ஐ paste பண்ணு.
// sb_publishable_... key மட்டும் பயன்படுத்தவும்.
// service_role / secret key பயன்படுத்தக்கூடாது.
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_6FfBPZ1nc5AQqjVRi_VhgA_WZC1tQ-J";


// Create Supabase client
const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);


// ========================================
// LOGIN PAGE
// ========================================

const loginForm = document.getElementById("loginForm");

if (loginForm) {

    loginForm.addEventListener("submit", async function (event) {

        event.preventDefault();

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const message = document.getElementById("message");
        const loginButton = document.getElementById("loginButton");

        message.textContent = "";
        loginButton.disabled = true;
        loginButton.textContent = "Logging in...";


        try {

            // Login with Supabase Auth
            const { data, error } =
                await supabaseClient.auth.signInWithPassword({
                    email: email,
                    password: password
                });


            if (error) {
                throw error;
            }


            if (!data.user) {
                throw new Error("Login failed.");
            }


            // Check admin role
            const { data: profile, error: profileError } =
                await supabaseClient
                    .from("profiles")
                    .select("role")
                    .eq("id", data.user.id)
                    .single();


            if (profileError) {
                await supabaseClient.auth.signOut();
                throw new Error("Profile not found.");
            }


            // Only admin can enter dashboard
            if (profile.role !== "admin") {

                await supabaseClient.auth.signOut();

                throw new Error(
                    "This account does not have admin access."
                );
            }


            message.textContent = "Login successful. Opening dashboard...";
            message.style.color = "green";


            // Open dashboard
            window.location.href = "dashboard.html";

        } catch (error) {

            message.textContent =
                error.message || "Login failed.";

            message.style.color = "red";

            loginButton.disabled = false;
            loginButton.textContent = "Login";
        }

    });

}


// ========================================
// DASHBOARD PAGE
// ========================================

const adminEmail = document.getElementById("adminEmail");

if (adminEmail) {

    checkAdminAccess();

}


// Check current user + admin role
async function checkAdminAccess() {

    try {

        const {
            data: { user },
            error: userError
        } = await supabaseClient.auth.getUser();


        if (userError || !user) {

            window.location.href = "index.html";
            return;
        }


        // Get profile
        const { data: profile, error: profileError } =
            await supabaseClient
                .from("profiles")
                .select("full_name, role")
                .eq("id", user.id)
                .single();


        if (profileError || !profile) {

            await supabaseClient.auth.signOut();

            window.location.href = "index.html";
            return;
        }


        // Verify admin
        if (profile.role !== "admin") {

            await supabaseClient.auth.signOut();

            alert("Admin access required.");

            window.location.href = "index.html";
            return;
        }


        // Show admin information
        adminEmail.textContent =
            "Logged in as: " + user.email;


    } catch (error) {

        console.error("Admin verification error:", error);

        await supabaseClient.auth.signOut();

        window.location.href = "index.html";
    }

}


// ========================================
// LOGOUT
// ========================================

const logoutButton = document.getElementById("logoutButton");

if (logoutButton) {

    logoutButton.addEventListener("click", async function () {

        logoutButton.disabled = true;
        logoutButton.textContent = "Logging out...";

        await supabaseClient.auth.signOut();

        window.location.href = "index.html";

    });

}
