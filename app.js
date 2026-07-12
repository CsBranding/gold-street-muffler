/* ==========================================================================
   Gold Street Muffler & Auto Repair - Interactive Logic (JavaScript)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Mobile Menu Toggle ---
    const mobileToggle = document.querySelector('.mobile-toggle');
    const mobileNav = document.querySelector('.mobile-nav');

    if (mobileToggle && mobileNav) {
        mobileToggle.addEventListener('click', () => {
            mobileNav.classList.toggle('active');
            // Toggle hamburger icon if needed
            const isExpanded = mobileNav.classList.contains('active');
            mobileToggle.setAttribute('aria-expanded', isExpanded);
        });

        // Close mobile nav when clicking a link
        const mobileLinks = mobileNav.querySelectorAll('.mobile-nav-link');
        mobileLinks.forEach(link => {
            link.addEventListener('click', () => {
                mobileNav.classList.remove('active');
            });
        });
    }

    // --- 2. Estimate Request Modal Logic ---
    const modal = document.getElementById('booking-modal');
    const openBtns = document.querySelectorAll('.open-modal-btn');
    const closeBtn = document.querySelector('.modal-close');
    const modalForm = document.getElementById('modal-form');
    const modalSuccess = document.getElementById('modal-success');

    const openModal = () => {
        if (modal) {
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden'; // Stop page scrolling
        }
    };

    const closeModal = () => {
        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = ''; // Restore scrolling
            // Reset form and alerts
            if (modalForm) {
                modalForm.reset();
                modalForm.classList.remove('hidden');
            }
            if (modalSuccess) {
                modalSuccess.classList.add('hidden');
            }
        }
    };

    openBtns.forEach(btn => btn.addEventListener('click', openModal));
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Close modal when clicking on the overlay backdrop
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }

    // Close modal on Escape key press
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });

    // --- 3. Contact Form Submission (Main Site) ---
    const contactForm = document.getElementById('contact-form');
    const formSuccess = document.getElementById('form-success');

    if (contactForm && formSuccess) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // Simulate form submission status
            const submitBtn = contactForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending Request...';

            setTimeout(() => {
                contactForm.classList.add('hidden');
                formSuccess.classList.remove('hidden');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }, 1200);
        });
    }

    // --- 4. Modal Form Submission ---
    if (modalForm && modalSuccess) {
        modalForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const submitBtn = modalForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending Request...';

            setTimeout(() => {
                modalForm.classList.add('hidden');
                modalSuccess.classList.remove('hidden');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }, 1200);
        });
    }

    // --- 5. Scroll Reveal Animation for Cards ---
    const revealElements = document.querySelectorAll('.feature-card, .service-item, .testimonial-card');
    
    // Add CSS initial state for scroll reveal
    revealElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    });

    const checkReveal = () => {
        const triggerBottom = window.innerHeight * 0.85;

        revealElements.forEach(el => {
            const elementTop = el.getBoundingClientRect().top;

            if (elementTop < triggerBottom) {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }
        });
    };

    // Initial check and scroll event listener
    checkReveal();
    window.addEventListener('scroll', checkReveal);
});
